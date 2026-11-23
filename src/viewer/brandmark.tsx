import "@fontsource-variable/lexend";

export function Wordmark() {
  return <span className="wordmark">tsumiki</span>;
}

export function Brandmark() {
  return (
    <span className="brandmark">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet="/tsumiki-logo-dark.svg" />
        <img src="/tsumiki-logo.svg" alt="" width={32} height={32} />
      </picture>
      <Wordmark />
    </span>
  );
}
