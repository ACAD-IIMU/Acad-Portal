const LINKS = [
  { label: 'Moodle', href: 'https://iimu-production.azrisolutions.com/login/index.php?loginredirect=1' },
  { label: 'ERP', href: 'https://sisportal-100695.campusnexus.cloud/CMCPortal/' }
];

export default function QuickLinks() {
  return (
    <div className="card p-5">
      <h2 className="text-sm mb-3">Quick links</h2>
      <div className="flex flex-col gap-2">
        {LINKS.map((l) => (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg border border-line px-3.5 py-2.5 text-sm font-semibold text-brand-900 hover:border-brand-700 hover:bg-brand-50 transition"
          >
            {l.label} <span className="text-inkFaint">↗</span>
          </a>
        ))}
      </div>
    </div>
  );
}
