/** Basit inline SVG mark — resmi asset dump değil. */

export const logoSpotify = `<svg class="brand-mark" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
  <circle cx="12" cy="12" r="12" fill="currentColor" opacity="0.18"/>
  <path fill="currentColor" d="M16.8 10.6c-2.2-1.3-5.9-1.4-8-.8-.3.1-.7-.1-.8-.4-.1-.3.1-.7.4-.8 2.5-.7 6.6-.6 9.1.9.3.2.4.5.2.8-.1.3-.5.4-.9.3zm-.1 2.1c-.2.2-.4.3-.7.2-1.9-1.1-4.7-1.5-6.9-.8-.3.1-.6-.1-.7-.3-.1-.3.1-.6.3-.7 2.5-.8 5.7-.4 7.9 1 .2.1.3.4.1.6zm-.9 2c-.1.2-.3.3-.5.2-1.6-1-3.6-1.2-6-.7-.2.1-.5-.1-.5-.3-.1-.2.1-.5.3-.5 2.6-.6 4.9-.4 6.7.7.2.1.2.4.2.6z"/>
</svg>`;

/** Chart.js / UI pastel paleti */
export const PASTEL = {
  spotify: {
    solid: "#8fd4a8",
    fill: "rgba(143, 212, 168, 0.22)",
    soft: ["#8fd4a8", "#a8dfbc", "#6fc492", "#b8e6c8", "#7bcfa0"],
  },
  axis: "#9aa3b2",
  grid: "rgba(42, 47, 58, 0.9)",
};

export function brandTitle(provider, title) {
  const logo = provider === "spotify" ? logoSpotify : "";
  return `<div class="section-head">${logo}<h2>${title}</h2></div>`;
}
