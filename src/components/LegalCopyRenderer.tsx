import type { LegalBlock, LegalCopy } from "@/lib/legal";

const renderBullet = (bullet: NonNullable<LegalBlock["bullets"]>[number]) => {
  const content = (
    <>
      {bullet.label && <strong>{bullet.label}:</strong>} {bullet.text}
    </>
  );

  if (!bullet.href) return content;

  return (
    <a href={bullet.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-primary">
      {content}
    </a>
  );
};

export const LegalBlocks = ({ blocks }: { blocks: LegalBlock[] }) => (
  <div className="legal-copy space-y-5 text-[0.95rem] leading-7 text-foreground/85">
    {blocks.map((block) => (
      <section key={block.heading} className="space-y-2">
        <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-primary">
          {block.heading}
        </h3>
        {block.paragraphs?.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        {block.bullets && (
          <ul className="list-disc space-y-1.5 pl-5">
            {block.bullets.map((bullet, index) => (
              <li key={`${block.heading}-${index}`}>{renderBullet(bullet)}</li>
            ))}
          </ul>
        )}
        {block.links && block.links.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {block.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}
      </section>
    ))}
  </div>
);

export const LegalCopyRenderer = ({ copy }: { copy: LegalCopy }) => (
  <>
    <div className="space-y-3 pr-1">
      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">{copy.title}</h2>
      <p className="text-sm font-medium text-muted-foreground">{copy.updated}</p>
    </div>
    <LegalBlocks blocks={copy.blocks} />
  </>
);
