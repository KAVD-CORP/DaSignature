package app.dasignature;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import net.zetetic.database.sqlcipher.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * DaSignature's only native plugin (M8, SPEC Sec 6): SQLite + SQLCipher for the database, the app
 * sandbox for encrypted file blobs, an Android-Keystore-wrapped secret store for the database and
 * vault keys, PDFs handed over by VIEW / SEND intents, and native Save / Share for exports.
 * Wire format matches the Tauri shell: bytes are base64, SQL blobs are {"$blob": base64}.
 * No network: the app ships without the INTERNET permission.
 */
@CapacitorPlugin(name = "DaSignatureNative")
public class DaSignatureNativePlugin extends Plugin {
    private static final String WRAP_ALIAS = "dasig.wrap";
    private static final String PREFS = "dasig.secrets";
    private static final Pattern SAFE_PATH = Pattern.compile("^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$");
    private static final Pattern SAFE_NAME = Pattern.compile("^[a-z0-9._-]{1,64}$");
    private static final long MAX_OPEN_BYTES = 200L * 1024 * 1024;

    private SQLiteDatabase db;
    private final List<JSObject> opened = new ArrayList<>();

    @Override
    public void load() {
        System.loadLibrary("sqlcipher");
        Activity a = getActivity();
        if (a != null) collect(a.getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (collect(intent)) notifyListeners("opened", new JSObject());
    }

    // ---------- database ----------

    @PluginMethod
    public synchronized void dbOpen(PluginCall call) {
        String name = call.getString("database", "dasignature");
        String pass = call.getString("passphrase");
        if (pass == null || !SAFE_NAME.matcher(name).matches()) {
            call.reject("bad database or passphrase");
            return;
        }
        try {
            if (db != null) db.close();
            File f = getContext().getDatabasePath(name + ".db");
            File dir = f.getParentFile();
            if (dir != null && !dir.exists() && !dir.mkdirs()) throw new IOException("mkdirs");
            db = SQLiteDatabase.openOrCreateDatabase(f, pass, null, null, null);
            Cursor c = db.rawQuery("SELECT count(*) FROM sqlite_master", (Object[]) null);
            c.close();
            call.resolve();
        } catch (Exception e) {
            db = null;
            call.reject("cannot open database: " + e.getMessage());
        }
    }

    @PluginMethod
    public synchronized void dbRun(PluginCall call) {
        if (db == null) {
            call.reject("database not open");
            return;
        }
        try {
            db.execSQL(call.getString("sql", ""), args(call.getArray("values", new JSArray())));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public synchronized void dbQuery(PluginCall call) {
        if (db == null) {
            call.reject("database not open");
            return;
        }
        try (Cursor c = db.rawQuery(call.getString("sql", ""), args(call.getArray("values", new JSArray())))) {
            JSArray rows = new JSArray();
            while (c.moveToNext()) {
                JSONObject row = new JSONObject();
                for (int i = 0; i < c.getColumnCount(); i++) {
                    String k = c.getColumnName(i);
                    switch (c.getType(i)) {
                        case Cursor.FIELD_TYPE_INTEGER: row.put(k, c.getLong(i)); break;
                        case Cursor.FIELD_TYPE_FLOAT: row.put(k, c.getDouble(i)); break;
                        case Cursor.FIELD_TYPE_STRING: row.put(k, c.getString(i)); break;
                        case Cursor.FIELD_TYPE_BLOB:
                            row.put(k, new JSONObject().put("$blob", b64(c.getBlob(i))));
                            break;
                        default: row.put(k, JSONObject.NULL);
                    }
                }
                rows.put(row);
            }
            JSObject out = new JSObject();
            out.put("rows", rows);
            call.resolve(out);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public synchronized void dbClose(PluginCall call) {
        if (db != null) db.close();
        db = null;
        call.resolve();
    }

    private static Object[] args(JSArray values) throws JSONException {
        Object[] out = new Object[values.length()];
        for (int i = 0; i < values.length(); i++) {
            Object v = values.get(i);
            if (v == JSONObject.NULL) out[i] = null;
            else if (v instanceof JSONObject && ((JSONObject) v).has("$blob"))
                out[i] = Base64.decode(((JSONObject) v).getString("$blob"), Base64.NO_WRAP);
            else if (v instanceof Boolean) out[i] = ((Boolean) v) ? 1L : 0L;
            else if (v instanceof Integer) out[i] = ((Integer) v).longValue();
            else if (v instanceof JSONArray || v instanceof JSONObject)
                throw new JSONException("unsupported SQL value");
            else out[i] = v;
        }
        return out;
    }

    // ---------- sandbox files ----------

    private File sandbox(String path) throws IOException {
        if (path == null || !SAFE_PATH.matcher(path).matches() || path.contains(".."))
            throw new IOException("bad path");
        return new File(new File(getContext().getFilesDir(), "dasig"), path);
    }

    @PluginMethod
    public void fileWrite(PluginCall call) {
        try {
            File f = sandbox(call.getString("path"));
            File dir = f.getParentFile();
            if (dir != null && !dir.exists() && !dir.mkdirs()) throw new IOException("mkdirs");
            File tmp = new File(f.getPath() + ".tmp");
            try (OutputStream o = new FileOutputStream(tmp)) {
                o.write(Base64.decode(call.getString("data", ""), Base64.NO_WRAP));
            }
            if (!tmp.renameTo(f)) throw new IOException("rename");
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void fileRead(PluginCall call) {
        try {
            File f = sandbox(call.getString("path"));
            JSObject out = new JSObject();
            out.put("data", f.isFile() ? b64(Files.readAllBytes(f.toPath())) : JSONObject.NULL);
            call.resolve(out);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void fileRemove(PluginCall call) {
        try {
            File f = sandbox(call.getString("path"));
            if (f.exists() && !f.delete()) throw new IOException("delete failed");
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void usage(PluginCall call) {
        long used = size(new File(getContext().getFilesDir(), "dasig"));
        used += size(getContext().getDatabasePath("dasignature.db"));
        JSObject out = new JSObject();
        out.put("used", used);
        call.resolve(out);
    }

    private static long size(File f) {
        if (f.isFile()) return f.length();
        long n = 0;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) n += size(k);
        return n;
    }

    // ---------- Keystore-wrapped secrets ----------

    private SecretKey wrapKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(WRAP_ALIAS)) return (SecretKey) ks.getKey(WRAP_ALIAS, null);
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(WRAP_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return g.generateKey();
    }

    @PluginMethod
    public synchronized void secretGetOrCreate(PluginCall call) {
        String name = call.getString("name", "");
        if (!SAFE_NAME.matcher(name).matches()) {
            call.reject("bad secret name");
            return;
        }
        try {
            SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            SecretKey k = wrapKey();
            byte[] secret;
            String stored = p.getString(name, null);
            if (stored != null) {
                byte[] blob = Base64.decode(stored, Base64.NO_WRAP);
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, blob, 0, 12));
                secret = c.doFinal(blob, 12, blob.length - 12);
            } else {
                secret = new byte[32];
                new SecureRandom().nextBytes(secret);
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.ENCRYPT_MODE, k);
                byte[] iv = c.getIV();
                byte[] ct = c.doFinal(secret);
                byte[] blob = new byte[iv.length + ct.length];
                System.arraycopy(iv, 0, blob, 0, iv.length);
                System.arraycopy(ct, 0, blob, iv.length, ct.length);
                if (!p.edit().putString(name, b64(blob)).commit()) throw new IOException("store failed");
            }
            JSObject out = new JSObject();
            out.put("secret", b64(secret));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("secure key store: " + e.getMessage());
        }
    }

    @PluginMethod
    public synchronized void secretDelete(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(call.getString("name", "")).commit();
        call.resolve();
    }

    // ---------- PDFs handed to the app (VIEW / SEND intents) ----------

    private synchronized boolean collect(Intent intent) {
        if (intent == null) return false;
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) uris.add(intent.getData());
        else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        boolean any = false;
        for (Uri u : uris) {
            try {
                JSObject f = new JSObject();
                f.put("name", displayName(u));
                f.put("data", b64(readAll(u)));
                opened.add(f);
                any = true;
            } catch (Exception ignored) {
                // unreadable or too large: skipped; the user can still open it from the picker
            }
        }
        intent.setAction(null);
        return any;
    }

    private String displayName(Uri u) {
        try (Cursor c = getContext().getContentResolver().query(u, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String n = c.getString(0);
                if (n != null) return n;
            }
        } catch (Exception ignored) {
            // fall through
        }
        String last = u.getLastPathSegment();
        return last != null ? last : "document.pdf";
    }

    private byte[] readAll(Uri u) throws IOException {
        ContentResolver r = getContext().getContentResolver();
        try (InputStream in = r.openInputStream(u)) {
            if (in == null) throw new IOException("no stream");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[1 << 16];
            long total = 0;
            for (int n; (n = in.read(buf)) > 0; ) {
                total += n;
                if (total > MAX_OPEN_BYTES) throw new IOException("too large");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    @PluginMethod
    public synchronized void takeOpenedFiles(PluginCall call) {
        JSArray files = new JSArray();
        for (JSObject f : opened) files.put(f);
        opened.clear();
        JSObject out = new JSObject();
        out.put("files", files);
        call.resolve(out);
    }

    // ---------- exports: Save (Storage Access Framework) and Share ----------

    @PluginMethod
    public void saveFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/pdf"));
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "document.pdf"));
        startActivityForResult(call, i, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject out = new JSObject();
        Uri u = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || u == null) {
            out.put("savedAs", JSONObject.NULL);
            call.resolve(out);
            return;
        }
        try (OutputStream o = getContext().getContentResolver().openOutputStream(u, "wt")) {
            if (o == null) throw new IOException("no stream");
            o.write(Base64.decode(call.getString("data", ""), Base64.NO_WRAP));
            out.put("savedAs", displayName(u));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        try {
            File dir = new File(getContext().getCacheDir(), "share");
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdirs");
            String name = call.getString("name", "document.pdf").replaceAll("[\\\\/:*?\"<>|]", "_");
            File f = new File(dir, name);
            try (OutputStream o = new FileOutputStream(f)) {
                o.write(Base64.decode(call.getString("data", ""), Base64.NO_WRAP));
            }
            Uri u = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(call.getString("mime", "application/pdf"));
            send.putExtra(Intent.EXTRA_STREAM, u);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, null);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            JSObject out = new JSObject();
            out.put("shared", true);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("share failed: " + e.getMessage());
        }
    }

    private static String b64(byte[] b) {
        return Base64.encodeToString(b, Base64.NO_WRAP);
    }
}
