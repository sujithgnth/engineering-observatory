/* global IntersectionObserver, document, navigator, window */

const header = document.querySelector("[data-header]");
const revealElements = document.querySelectorAll("[data-reveal]");
const year = document.querySelector("[data-year]");
const copyButton = document.querySelector("[data-copy-command]");

const command = `git clone https://github.com/sujithgnth/engineering-observatory.git
cd engineering-observatory
npm ci
cp .env.example .env
docker compose up -d postgres
npm run desktop:dev`;

if (year) {
  year.textContent = String(new Date().getFullYear());
}

const updateHeader = () =>
  header?.classList.toggle("scrolled", window.scrollY > 24);
updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );

  revealElements.forEach((element) => observer.observe(element));
} else {
  revealElements.forEach((element) => element.classList.add("visible"));
}

copyButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(command);
    copyButton.textContent = "Copied";
    window.setTimeout(() => {
      copyButton.textContent = "Copy";
    }, 1800);
  } catch {
    copyButton.textContent = "Select commands";
  }
});
