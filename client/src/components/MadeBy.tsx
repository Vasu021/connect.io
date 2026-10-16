const GITHUB_URL = 'https://github.com/Vasu021';
const LINKEDIN_URL = 'https://www.linkedin.com/in/amlendu-shekhar';

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
           0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
           -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
           .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
           -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0
           1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
           1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01
           1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

function LinkedInMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M0 1.15C0 .51.53 0 1.19 0h13.62C15.47 0 16 .51 16 1.15v13.7c0 .64-.53
           1.15-1.19 1.15H1.19C.53 16 0 15.49 0 14.85V1.15ZM4.94 13.4V6.17H2.54v7.23
           h2.4Zm-1.2-8.22c.84 0 1.36-.55 1.36-1.24-.02-.7-.52-1.24-1.34-1.24-.82
           0-1.36.54-1.36 1.24 0 .69.52 1.24 1.33 1.24h.01Zm4.49 8.22V9.37c0-.22.02
           -.43.08-.59.17-.43.56-.88 1.22-.88.86 0 1.2.66 1.2 1.62v3.88h2.4V9.24
           c0-2.22-1.18-3.25-2.76-3.25-1.28 0-1.85.7-2.17 1.2v.03h-.02l.02-.03V6.17
           h-2.4c.03.68 0 7.23 0 7.23h2.4Z"
      />
    </svg>
  );
}

/** A quiet signature at the foot of the page. */
export function MadeBy() {
  return (
    <footer className="made-by">
      <span>Made by Vasu</span>
      <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub">
        <GitHubMark />
      </a>
      <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
        <LinkedInMark />
      </a>
    </footer>
  );
}
