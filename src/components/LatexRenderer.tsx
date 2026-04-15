"use client";

import { useEffect, useRef } from "react";

interface Props {
  latex: string;
}

export default function LatexRenderer({ latex }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !latex) return;

    async function render() {
      try {
        // Dynamic import to avoid SSR issues
        const { parse, HtmlGenerator } = await import("latex.js");

        // Wrap content in a minimal document if it doesn't have one
        let tex = latex;
        if (!tex.includes("\\begin{document}")) {
          tex = `\\documentclass{article}
\\usepackage[UTF8]{ctex}
\\begin{document}
${tex}
\\end{document}`;
        }

        const generator = new HtmlGenerator({ hyphenate: false });
        const doc = parse(tex, { generator });
        const htmlElement = doc.htmlDocument();

        // Extract body content
        const body = htmlElement.querySelector("body");
        if (body && containerRef.current) {
          containerRef.current.innerHTML = "";

          // Add latex.js CSS
          const style = htmlElement.querySelector("style");
          if (style) {
            containerRef.current.appendChild(style.cloneNode(true));
          }

          // Add all link elements (CSS)
          htmlElement.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
            containerRef.current!.appendChild(link.cloneNode(true));
          });

          // Add body content
          Array.from(body.children).forEach((child) => {
            containerRef.current!.appendChild(child.cloneNode(true));
          });
        }
      } catch (err) {
        // Fallback: show raw LaTeX with basic formatting
        if (containerRef.current) {
          containerRef.current.innerHTML = `<pre style="white-space: pre-wrap; font-family: serif; line-height: 1.8;">${escapeHtml(latex)}</pre>`;
        }
        console.error("LaTeX render error:", err);
      }
    }

    render();
  }, [latex]);

  return <div ref={containerRef} className="latex-rendered" />;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
