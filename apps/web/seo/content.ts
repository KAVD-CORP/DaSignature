/**
 * Copy for the public guide pages (decisions.md E-108). Every step names a real control in the app
 * (labels from packages/i18n/src/messages/en.ts); every claim about legal effect follows SPEC
 * Sec 9: DaSignature makes simple electronic signatures, not advanced or qualified ones, and this
 * is not legal advice. Don't add features here that the app doesn't have.
 */
import { GUIDES } from './routes.ts';

export const ORIGIN = 'https://dasignature.onrender.com';
export const REPO = 'https://github.com/KAVD-CORP/DaSignature';
export const RELEASES = `${REPO}/releases`;
export const APP = `${ORIGIN}/`;

export interface Step {
  name: string;
  text: string;
}
export interface Section {
  h: string;
  p?: string[];
  list?: string[];
}
export interface Faq {
  q: string;
  a: string;
}
export interface Page {
  /** '' is the landing page at /guides. */
  slug: string;
  /** <title>, also og:title. Unique per page. */
  title: string;
  /** Meta description, 70-160 characters. Unique per page. */
  description: string;
  h1: string;
  lead: string;
  /** Numbered how-to; emitted as HowTo JSON-LD as well. */
  howTo?: { name: string; steps: Step[] };
  sections: Section[];
  faqs: Faq[];
  /** Slugs of related guides. */
  related: string[];
}

export const pathOf = (slug: string) => (slug ? `${GUIDES}/${slug}` : GUIDES);
export const urlOf = (slug: string) => ORIGIN + pathOf(slug);

const OPEN: Step = {
  name: 'Open your PDF',
  text: 'Go to dasignature.onrender.com and choose Open PDF, or drop a PDF anywhere in the window. The file is opened on your device and is not uploaded. If the PDF is password protected, enter its password when asked.',
};
const SIGN: Step = {
  name: 'Create your signature',
  text: 'Choose Signature. The first time, the signature studio opens: draw with a mouse, finger or pen (Draw), type your name in a handwriting font (Type), use a photo of your signature (Upload) or photograph it on white paper (Scan). Select Save. Your signature is kept on this device for next time.',
};
const PLACE: Step = {
  name: 'Place it on the page',
  text: 'Tap or click the spot on the page where the signature goes (or press Enter to place it in the middle of the page). Drag it to move it and use the handles to resize or rotate it. The toolbar also has Duplicate, Opacity and Delete.',
};
const EXPORT: Step = {
  name: 'Export the signed copy',
  text: 'Choose Export (Ctrl+E). Check the file name, optionally turn on Add audit page, then Save. On a phone you can Share the copy or use Save to Files. A new signed copy is created; your original PDF is not changed.',
};

const LEGAL_FAQ: Faq = {
  q: 'Is a signature made with DaSignature legally binding?',
  a: 'DaSignature makes simple electronic signatures. In many places these are accepted for everyday documents such as forms, letters, leases and contracts (for example under the US ESIGN Act and UETA, and as a simple electronic signature under the EU eIDAS regulation). It does not make advanced or qualified electronic signatures, and some documents, such as wills or certain property and notarised documents, may need more. This is not legal advice: if in doubt, ask the person who asked you to sign.',
};
const UPLOAD_FAQ: Faq = {
  q: 'Is my PDF uploaded anywhere?',
  a: 'No. DaSignature has no servers and no accounts. The PDF is opened, signed and saved on your device, and the app makes no network requests while you use it. Documents and signatures are stored encrypted on the device.',
};
const COST_FAQ: Faq = {
  q: 'Is it really free?',
  a: 'Yes. DaSignature is open-source software under the Apache-2.0 licence. There is no subscription, no trial, no watermark and no limit on how many documents you sign.',
};
const OFFLINE_FAQ: Faq = {
  q: 'Does it work offline?',
  a: 'Yes. After the first visit the web app is stored by your browser and opens without an internet connection. You can also install it as an app from the browser.',
};

export const PAGES: Page[] = [
  {
    slug: '',
    title: 'DaSignature: free, private PDF signer for web, phone and desktop',
    description:
      'Sign and fill PDFs for free on your device. No upload, no account, no watermark. Open source, works offline in the browser and on Windows, Linux and Android.',
    h1: 'Sign PDFs privately, for free',
    lead: 'DaSignature is a free, open-source app for signing and filling in PDFs. Your files never leave your device: there are no accounts, no uploads and no servers. It runs in any modern browser, works offline, and has desktop and Android builds from the same code.',
    howTo: { name: 'How to sign a PDF with DaSignature', steps: [OPEN, SIGN, PLACE, EXPORT] },
    sections: [
      {
        h: 'What you can do',
        list: [
          'Open any PDF, including password-protected ones, by picking it, dropping it on the window, or sharing it to the installed app.',
          'Create a signature by drawing, typing, uploading a photo or scanning it with your camera, and keep several signatures and initials.',
          'Place signatures, initials, dates, text, checkboxes and your full name anywhere on the page, then move, resize and rotate them, with undo and redo.',
          'Export a signed copy with an optional audit page (your name, the time and a SHA-256 fingerprint of the original). The original file is never changed.',
          'Check later whether a PDF is an exact copy you exported (Settings, Check a signed PDF).',
          'Lock the app with a passcode and make encrypted .dasig backups of your documents and signatures.',
        ],
      },
      {
        h: 'Private by design',
        p: [
          'The app has no account system, no cloud storage and no analytics, and it makes no network requests while you use it. Documents, signatures and settings are stored encrypted on your device. The source code is public, so anyone can check this.',
        ],
      },
      {
        h: 'Where it runs',
        list: [
          'Web app: any current version of Chrome, Edge, Firefox or Safari, on computers, tablets and phones. It can be installed from the browser and works offline.',
          'Windows and Linux desktop apps, and an Android app, built from the same code (see the project’s GitHub releases).',
          'macOS and iOS native builds are build-from-source for now. On a Mac, iPhone or iPad, use the web app.',
        ],
      },
      {
        h: 'What kind of signature it makes',
        p: [
          'DaSignature makes simple electronic signatures: an image of your signature placed on the document, plus an optional audit page. It does not make certificate-based digital signatures (advanced or qualified electronic signatures), and it is not legal advice.',
        ],
      },
    ],
    faqs: [COST_FAQ, UPLOAD_FAQ, OFFLINE_FAQ, LEGAL_FAQ],
    related: [
      'sign-pdf-online',
      'fill-out-pdf-form',
      'add-signature-to-pdf',
      'initials-and-date-on-pdf',
      'free-e-signature',
      'private-offline-pdf-signer',
      'sign-pdf-on-iphone',
      'sign-pdf-on-android',
      'sign-pdf-windows',
      'sign-pdf-on-mac',
      'docusign-alternative-free',
      'are-electronic-signatures-legal',
    ],
  },
  {
    slug: 'sign-pdf-online',
    title: 'Sign a PDF online for free, without uploading it | DaSignature',
    description:
      'Sign a PDF in your browser in four steps. DaSignature opens the file on your device, so nothing is uploaded. Free, no account, no watermark.',
    h1: 'Sign a PDF online, without uploading it',
    lead: 'Most online PDF signers upload your document to their servers. DaSignature runs in your browser but does the work on your device, so the PDF never leaves it. It is free and needs no account.',
    howTo: { name: 'How to sign a PDF online', steps: [OPEN, SIGN, PLACE, EXPORT] },
    sections: [
      {
        h: 'Why “online” doesn’t mean uploaded here',
        p: [
          'DaSignature is a web app that is downloaded once into your browser, like any website. After that, opening, signing and saving the PDF all happen on your computer or phone. The app makes no network requests while you work, and it keeps working if you go offline.',
        ],
      },
      {
        h: 'Tips',
        list: [
          'Signing the same kind of document often? Your signatures and initials are saved, so next time you just pick one and tap the page.',
          'Use Date for today’s date in the format you choose, and Full name for your typed name.',
          'Turn on Add audit page when exporting if you want a last page that records your name, the time and a SHA-256 fingerprint of the original file.',
        ],
      },
    ],
    faqs: [UPLOAD_FAQ, COST_FAQ, LEGAL_FAQ],
    related: ['add-signature-to-pdf', 'fill-out-pdf-form', 'private-offline-pdf-signer'],
  },
  {
    slug: 'free-e-signature',
    title: 'Free e-signature for PDFs: no account, no limits | DaSignature',
    description:
      'Make a free electronic signature and add it to any PDF. Draw, type, upload or scan it. Open-source, no subscription, no document limit, no watermark.',
    h1: 'A free e-signature for your PDFs',
    lead: 'DaSignature lets you create an electronic signature once and put it on as many PDFs as you like, for free. It is open-source, so there is no trial that runs out and no paid tier.',
    howTo: {
      name: 'How to make a free electronic signature',
      steps: [
        {
          name: 'Open the signature studio',
          text: 'Open dasignature.onrender.com, go to Signatures and choose New signature (or choose Signature while signing a PDF).',
        },
        {
          name: 'Draw, type, upload or scan',
          text: 'Draw it with a mouse, finger or stylus; type your name and pick a handwriting font; upload a photo of your signature (Remove background cleans up the paper); or use Scan to photograph it on white paper with your camera.',
        },
        {
          name: 'Adjust and save',
          text: 'Pick the ink colour and, for drawn signatures, the pen settings such as weight, smoothing and taper. Select Save. You can mark one signature as your default.',
        },
        PLACE,
        EXPORT,
      ],
    },
    sections: [
      {
        h: 'What you get for free',
        list: [
          'Unlimited documents and signatures, with no watermark.',
          'Several signatures and sets of initials, stored encrypted on your device.',
          'Dates, text, checkboxes and your full name as extra fields.',
          'An optional audit page and an embedded record of who signed and when.',
        ],
      },
      {
        h: 'What it is not',
        p: [
          'DaSignature makes simple electronic signatures. It does not send documents to other people for signing, and it does not create certificate-based (advanced or qualified) digital signatures. If you need those, you need a service that offers them.',
        ],
      },
    ],
    faqs: [COST_FAQ, LEGAL_FAQ, UPLOAD_FAQ],
    related: [
      'add-signature-to-pdf',
      'docusign-alternative-free',
      'are-electronic-signatures-legal',
    ],
  },
  {
    slug: 'fill-out-pdf-form',
    title: 'Fill out a PDF form and sign it, free and private | DaSignature',
    description:
      'Fill in a PDF form by adding text, dates, checkmarks and your signature on top of it. Works on any PDF, even scanned ones. Free, nothing uploaded.',
    h1: 'Fill out a PDF form and sign it',
    lead: 'DaSignature fills in forms by placing text, dates, checkmarks and signatures exactly where you need them on the page. Because it works on top of the page, it also works for scanned or printed-and-scanned forms that have no form fields.',
    howTo: {
      name: 'How to fill out a PDF form',
      steps: [
        OPEN,
        {
          name: 'Add text',
          text: 'Choose Text and tap the box on the form where the answer goes. Type the answer in Text. Move and resize the field so it sits on the line.',
        },
        {
          name: 'Tick boxes and add dates',
          text: 'Choose Checkbox and tap each box you need to tick. Choose Date for a date; it shows today’s date by default, and you can pick another date and the date format.',
        },
        {
          name: 'Sign',
          text: 'Choose Signature, Initials or Full name and tap where each one goes. Duplicate is handy when the same initials are needed on several lines.',
        },
        {
          name: 'Export',
          text: 'Choose Export. If the PDF has its own form fields, Flatten form fields turns them into part of the page so they can’t be edited later. Then Save, or Share on a phone.',
        },
      ],
    },
    sections: [
      {
        h: 'Interactive form fields',
        p: [
          'Some PDFs have built-in fields. DaSignature shows them as they are, with any values already filled in, but you don’t type into those built-in fields directly: you place your own Text, Date and Checkbox fields over them, which works the same way on every PDF. The exported copy has your answers baked into the page.',
        ],
      },
      {
        h: 'Good to know',
        list: [
          'Your original PDF is never changed. Every export is a new copy.',
          'Your work is saved as you go, with undo and redo, so you can come back to a half-filled form.',
          'Nothing is uploaded: forms with personal details stay on your device.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I fill in a scanned form?',
        a: 'Yes. Because fields are placed on top of the page, a scanned form works the same as any other PDF.',
      },
      {
        q: 'Can someone change my answers after I export?',
        a: 'Your text, dates and checkmarks are drawn into the page of the exported copy, so they are not editable form fields. Anyone with a PDF editor can still alter any PDF; the optional audit page records a SHA-256 fingerprint of the original, and Settings, Check a signed PDF tells you whether a file is an exact copy you exported.',
      },
      UPLOAD_FAQ,
    ],
    related: ['initials-and-date-on-pdf', 'sign-pdf-online', 'add-signature-to-pdf'],
  },
  {
    slug: 'add-signature-to-pdf',
    title: 'Add a signature to a PDF: draw, type, upload or scan | DaSignature',
    description:
      'Add your handwritten signature to a PDF. Draw it, type it, upload a photo or scan it with your camera, then place, resize and rotate it. Free and private.',
    h1: 'Add a signature to a PDF',
    lead: 'There are four ways to make the signature you put on a PDF in DaSignature. Pick whichever looks most like you, save it once and reuse it.',
    howTo: { name: 'How to add a signature to a PDF', steps: [OPEN, SIGN, PLACE, EXPORT] },
    sections: [
      {
        h: 'Four ways to make your signature',
        list: [
          'Draw: sign with a mouse, trackpad, finger or stylus. Pen settings (weight, thinness, taper, smoothing and pressure) let you make it look like real ink.',
          'Type: type your name and choose one of the handwriting fonts.',
          'Upload: use a photo or image of your signature. Remove background, Contrast and Ink colour clean it up.',
          'Scan: on devices with a camera, sign on white paper and photograph it inside the frame.',
        ],
      },
      {
        h: 'Placing it neatly',
        list: [
          'Drag to move, and use the handles to resize or rotate. Lock aspect ratio keeps the shape.',
          'Opacity makes the signature lighter if it covers printed text.',
          'Delete removes it; undo brings it back.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Where is my signature stored?',
        a: 'Only on your device, encrypted. It is never uploaded. You can make an encrypted backup (Settings, Backup and restore) to move it to another device.',
      },
      {
        q: 'Can I use a different signature for different documents?',
        a: 'Yes. Save as many signatures and initials as you like and pick one each time. One can be set as your default.',
      },
      LEGAL_FAQ,
    ],
    related: ['free-e-signature', 'initials-and-date-on-pdf', 'sign-pdf-online'],
  },
  {
    slug: 'sign-pdf-on-iphone',
    title: 'Sign a PDF on iPhone or iPad, free and private | DaSignature',
    description:
      'Sign PDFs on your iPhone or iPad in Safari with your finger. Nothing is uploaded, no account, no app store download needed. Add it to your Home Screen.',
    h1: 'Sign a PDF on iPhone or iPad',
    lead: 'On iPhone and iPad, DaSignature runs as a web app in Safari. You sign with your finger or Apple Pencil, and the PDF stays on your device.',
    howTo: {
      name: 'How to sign a PDF on iPhone',
      steps: [
        {
          name: 'Open DaSignature in Safari',
          text: 'Go to dasignature.onrender.com in Safari. To keep it handy, tap Share, then Add to Home Screen; it then opens like an app and works offline.',
        },
        {
          name: 'Open your PDF',
          text: 'Tap Open PDF and pick the file from Files, iCloud Drive or another location. (To sign an email attachment, first save it to Files.)',
        },
        {
          name: 'Sign with your finger',
          text: 'Tap Signature in the toolbar at the bottom. Draw your signature with your finger or Apple Pencil, or use Type or Upload, then tap Save.',
        },
        {
          name: 'Place it',
          text: 'Tap the spot on the page where it goes. Drag to move it and use the handles to resize it. Add Initials, Date, Text or Checkbox the same way.',
        },
        {
          name: 'Share or save',
          text: 'Tap Export, then Share to send the signed copy by Mail or Messages, or Save to Files. Your original is unchanged.',
        },
      ],
    },
    sections: [
      {
        h: 'Is there an iPhone app?',
        p: [
          'Not in the App Store yet. The iOS app exists only as source code for now, so the web app in Safari is the way to use DaSignature on iPhone and iPad. It needs a recent version of iOS or iPadOS (Safari 16.4 or newer).',
        ],
      },
      {
        h: 'Keep your signatures safe',
        p: [
          'Safari can clear website data, for example if you don’t use the site for a long time. Make a backup in Settings (Backup and restore) and keep the .dasig file in Files or iCloud Drive.',
        ],
      },
    ],
    faqs: [UPLOAD_FAQ, OFFLINE_FAQ, COST_FAQ],
    related: ['sign-pdf-on-android', 'sign-pdf-online', 'fill-out-pdf-form'],
  },
  {
    slug: 'sign-pdf-on-android',
    title: 'Sign a PDF on Android, free and without uploading | DaSignature',
    description:
      'Sign PDFs on an Android phone or tablet with your finger. Use the web app in Chrome or install the Android app. No upload, no account, works offline.',
    h1: 'Sign a PDF on Android',
    lead: 'On Android you can use DaSignature in Chrome or install it. Either way you sign with your finger and the PDF never leaves your phone.',
    howTo: {
      name: 'How to sign a PDF on Android',
      steps: [
        {
          name: 'Open DaSignature',
          text: 'Go to dasignature.onrender.com in Chrome. To install it, open the Chrome menu and choose Install app or Add to Home screen. Once installed, you can also share a PDF to DaSignature from another app.',
        },
        {
          name: 'Open your PDF',
          text: 'Tap Open PDF and choose the file, for example from Downloads or Drive.',
        },
        {
          name: 'Sign with your finger',
          text: 'Tap Signature in the bottom toolbar, draw your signature (or Type, Upload or Scan it with the camera) and tap Save.',
        },
        {
          name: 'Place it',
          text: 'Tap the page where it goes, then drag and resize. Add Initials, Date, Text or Checkbox the same way.',
        },
        {
          name: 'Share or save',
          text: 'Tap Export, then Share to send it with any app, or Save to Files to choose a folder.',
        },
      ],
    },
    sections: [
      {
        h: 'The Android app',
        p: [
          'There is also a native Android app built from the same code. It isn’t in Google Play; it is distributed as an APK on the project’s GitHub releases page. It asks for no permissions at all, not even internet access.',
        ],
      },
    ],
    faqs: [UPLOAD_FAQ, OFFLINE_FAQ, LEGAL_FAQ],
    related: ['sign-pdf-on-iphone', 'fill-out-pdf-form', 'private-offline-pdf-signer'],
  },
  {
    slug: 'sign-pdf-windows',
    title: 'Sign a PDF on Windows 10 or 11, free | DaSignature',
    description:
      'Sign PDFs on Windows in Edge or Chrome, or with the desktop app. Drag the PDF in, sign with your mouse or pen, save. Free, open-source, nothing uploaded.',
    h1: 'Sign a PDF on Windows',
    lead: 'On Windows 10 and 11, DaSignature runs in Edge or Chrome, or as a desktop app. You don’t need Adobe Acrobat or an account.',
    howTo: {
      name: 'How to sign a PDF on Windows',
      steps: [
        {
          name: 'Open DaSignature',
          text: 'Go to dasignature.onrender.com in Edge or Chrome. To install it as an app, use Install in the address bar or the browser menu.',
        },
        {
          name: 'Drag in your PDF',
          text: 'Drag the PDF from File Explorer onto the window, or choose Open PDF.',
        },
        {
          name: 'Sign',
          text: 'Choose Signature. Draw with your mouse, trackpad or pen, or type your name, then Save. Click the page where the signature goes.',
        },
        {
          name: 'Save the signed copy',
          text: 'Press Ctrl+E (Export), check the file name and choose Save. In the browser the signed copy is downloaded as a new file (usually to your Downloads folder); the desktop app asks where to save it. The original is unchanged.',
        },
      ],
    },
    sections: [
      {
        h: 'Desktop app',
        p: [
          'There is also a Windows desktop app built from the same code, installed per user without administrator rights. It adds an “Open with DaSignature” entry for PDFs. Downloads are on the project’s GitHub releases page. The installer isn’t code-signed yet, so Windows SmartScreen may warn you; you can check the file against the published SHA-256 sums.',
        ],
      },
      {
        h: 'Keyboard friendly',
        list: [
          'Ctrl+E opens Export.',
          'With a field tool selected, Enter places it in the middle of the page.',
          'Undo and redo work as usual.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Do I need Adobe Acrobat?',
        a: 'No. DaSignature opens and signs PDFs by itself, in the browser or the desktop app.',
      },
      UPLOAD_FAQ,
      COST_FAQ,
    ],
    related: ['sign-pdf-on-mac', 'sign-pdf-online', 'private-offline-pdf-signer'],
  },
  {
    slug: 'sign-pdf-on-mac',
    title: 'Sign a PDF on a Mac in Safari or Chrome, free | DaSignature',
    description:
      'Sign PDFs on macOS with your trackpad in Safari, Chrome or Firefox. DaSignature keeps the file on your Mac. Free, open-source, no account.',
    h1: 'Sign a PDF on a Mac',
    lead: 'On a Mac, use DaSignature in Safari, Chrome, Edge or Firefox. You sign with the trackpad or mouse, and the PDF stays on your Mac.',
    howTo: {
      name: 'How to sign a PDF on a Mac',
      steps: [
        {
          name: 'Open DaSignature',
          text: 'Go to dasignature.onrender.com. In Safari you can choose File, Add to Dock to keep it as an app; in Chrome or Edge use Install.',
        },
        {
          name: 'Drag in your PDF',
          text: 'Drag the PDF from Finder onto the window, or choose Open PDF.',
        },
        SIGN,
        PLACE,
        EXPORT,
      ],
    },
    sections: [
      {
        h: 'Is there a Mac app?',
        p: [
          'A native macOS build exists in the source code but isn’t distributed yet, because it needs to be built and notarised on a Mac. The web app does everything the desktop app does.',
        ],
      },
    ],
    faqs: [UPLOAD_FAQ, OFFLINE_FAQ, COST_FAQ],
    related: ['sign-pdf-windows', 'sign-pdf-on-iphone', 'sign-pdf-online'],
  },
  {
    slug: 'initials-and-date-on-pdf',
    title: 'Add initials and the date to a PDF, page by page | DaSignature',
    description:
      'Add your initials and today’s date to every page of a contract or lease. Save your initials once, duplicate them, pick the date format. Free and private.',
    h1: 'Add initials and the date to a PDF',
    lead: 'Contracts and leases often ask for initials on every page and a date next to the signature. DaSignature has separate Initials and Date tools to make this quick.',
    howTo: {
      name: 'How to initial and date a PDF',
      steps: [
        OPEN,
        {
          name: 'Create your initials',
          text: 'Choose Initials. The first time, draw or type your initials in the studio and Save; they are kept for next time.',
        },
        {
          name: 'Initial each page',
          text: 'Tap the initials line on each page. Duplicate copies a placed field if you need it again nearby.',
        },
        {
          name: 'Add the date',
          text: 'Choose Date and tap where the date goes. It shows today’s date; you can pick a different date and change the Date format.',
        },
        EXPORT,
      ],
    },
    sections: [
      {
        h: 'Other fields',
        list: [
          'Full name adds your name as typed text (you enter it once, in Settings or the first time you use it).',
          'Text adds any other answer, such as an address or reference number.',
          'Checkbox ticks a box.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I change the date format?',
        a: 'Yes. Select the date on the page and choose a Date format; you can also pick a different date.',
      },
      LEGAL_FAQ,
      UPLOAD_FAQ,
    ],
    related: ['fill-out-pdf-form', 'add-signature-to-pdf', 'sign-pdf-online'],
  },
  {
    slug: 'private-offline-pdf-signer',
    title: 'Private, offline PDF signer: nothing leaves your device | DaSignature',
    description:
      'An open-source PDF signer that works offline and never uploads your files. No accounts, no cloud, encrypted storage, optional passcode lock.',
    h1: 'A private PDF signer that works offline',
    lead: 'If a document is confidential, you shouldn’t have to upload it to sign it. DaSignature keeps everything on your device and works with no internet connection at all.',
    sections: [
      {
        h: 'What stays private',
        list: [
          'No uploads: PDFs are opened, signed and saved on your device.',
          'No accounts, no cloud storage, no cookies and no analytics in the app; it makes no network requests while you use it.',
          'Documents, signatures and settings are stored encrypted (AES-256-GCM).',
          'Optional App lock with a 6-digit passcode and auto-lock.',
          'Backups are encrypted .dasig files protected by a password you choose.',
          'The code is open source, so you or anyone else can check all of this.',
        ],
      },
      {
        h: 'Using it offline',
        p: [
          'Open dasignature.onrender.com once while online; your browser then keeps the app, and it opens and works with no connection. Installing it (Install app or Add to Home Screen) puts it next to your other apps. The desktop and Android apps never need a connection.',
        ],
      },
      {
        h: 'What is shared when you share',
        p: [
          'Only what you choose. Export saves a signed copy where you pick, and Share hands it to the app you pick. The audit page, if you add it, includes your name, the time and a fingerprint of the original, but never your location.',
        ],
      },
    ],
    faqs: [
      UPLOAD_FAQ,
      OFFLINE_FAQ,
      {
        q: 'What happens if I clear my browser data?',
        a: 'The web app’s data is stored by your browser, so clearing site data deletes it. Make a backup in Settings (Backup and restore) to be safe.',
      },
    ],
    related: ['sign-pdf-online', 'free-e-signature', 'docusign-alternative-free'],
  },
  {
    slug: 'docusign-alternative-free',
    title: 'Free DocuSign alternative for signing your own PDFs | DaSignature',
    description:
      'Need to sign a PDF yourself, not send it out for signatures? DaSignature is a free, open-source, private alternative. See what it does and doesn’t do.',
    h1: 'A free alternative to DocuSign for signing PDFs yourself',
    lead: 'E-signature services are built for sending documents to other people and tracking their signatures. If you just need to sign a PDF someone sent you, DaSignature does that for free, on your device.',
    sections: [
      {
        h: 'When DaSignature is a good fit',
        list: [
          'Someone emailed you a PDF to sign and send back.',
          'You need to fill in and sign a form, lease or agreement.',
          'You don’t want to upload a confidential document or create an account.',
          'You want a tool that is free with no document limits.',
        ],
      },
      {
        h: 'When you need a signing service instead',
        list: [
          'You need to send a document to several people and collect their signatures with reminders and tracking. DaSignature has no sending, email or signer routing: each person signs on their own device and passes the file on.',
          'You need advanced or qualified electronic signatures with certificates, identity checks or a third-party audit trail. DaSignature makes simple electronic signatures only.',
          'Your organisation requires a specific provider.',
        ],
      },
      {
        h: 'How the signed copy is documented',
        p: [
          'DaSignature can add an audit page with your name, the time and the SHA-256 fingerprint of the original file, and it embeds the same record in the PDF. Settings, Check a signed PDF later confirms whether a file is an exact copy you exported. This is a record kept by you, not a certificate from a third party.',
        ],
      },
    ],
    faqs: [
      COST_FAQ,
      LEGAL_FAQ,
      {
        q: 'Is DaSignature affiliated with DocuSign?',
        a: 'No. DocuSign is a trademark of its owner. DaSignature is an independent open-source project.',
      },
    ],
    related: ['free-e-signature', 'are-electronic-signatures-legal', 'sign-pdf-online'],
  },
  {
    slug: 'are-electronic-signatures-legal',
    title: 'Are electronic signatures legal? A plain-language guide | DaSignature',
    description:
      'What a simple electronic signature is, where it is generally accepted, and when a document may need more. Plain language, not legal advice.',
    h1: 'Are electronic signatures legal?',
    lead: 'In many countries, an electronic signature can be just as valid as a handwritten one for everyday documents. But there are different kinds, and some documents need more. Here is what DaSignature makes, in plain language. This is general information, not legal advice.',
    sections: [
      {
        h: 'What DaSignature makes',
        p: [
          'A simple electronic signature: your signature (drawn, typed, uploaded or scanned) placed on the PDF, optionally with an audit page recording your name, the time and a fingerprint of the original file. It is not a certificate-based digital signature.',
        ],
      },
      {
        h: 'Where simple electronic signatures are generally accepted',
        list: [
          'United States: the ESIGN Act and the Uniform Electronic Transactions Act (UETA) say a signature or contract can’t be denied legal effect just because it is electronic.',
          'European Union: under the eIDAS regulation, a simple electronic signature can’t be refused as evidence just because it is electronic. eIDAS also defines advanced (AES) and qualified (QES) signatures, which DaSignature does not make.',
          'Many other countries have similar rules.',
        ],
      },
      {
        h: 'When you may need more',
        list: [
          'Wills, and some property, family-law or notarised documents.',
          'Documents where the law or the other party requires an advanced or qualified signature, a witness or a notary.',
          'Anything where you are unsure: ask the person or organisation that asked you to sign.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Is a typed name a valid signature?',
        a: 'Often, yes: many laws accept any electronic mark you adopt with the intent to sign. Whether it is enough for a particular document depends on the document and where you are.',
      },
      {
        q: 'Does DaSignature verify my identity?',
        a: 'No. It has no accounts and does no identity checks. The audit page records the name you entered and the time on your device.',
      },
      LEGAL_FAQ,
    ],
    related: ['free-e-signature', 'docusign-alternative-free', 'add-signature-to-pdf'],
  },
];
