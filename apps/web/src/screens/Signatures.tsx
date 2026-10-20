import { t } from '@dasignature/i18n';

export function Signatures() {
  return (
    <main className="mx-auto max-w-[1200px] p-4 tablet:p-6 desktop:p-8">
      <h1 className="text-headline font-semibold">{t('nav.signatures')}</h1>
    </main>
  );
}
