// ── Contact links ────────────────────────────────────────────────────────────
// The public contact-icon row, shared by the footer and the landing About card.
// Fields are grouped by social type: one of a type renders a direct icon link;
// two or more of the same type collapse into a single icon that opens a popover
// listing each link. No custom labels — the rows show the handles as entered.
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  contactFieldIcon,
  contactFieldLabel,
  groupContactFieldsByType,
  type ContactLinkField,
} from "@/lib/contact-fields";
import { isExternalContactUrl, normalizeContactUrl } from "@/services/contacts";
import { sanitizeDisplayText } from "@/lib/sanitize";

const resolveLink = (rawValue: string) => {
  const display = sanitizeDisplayText(rawValue);
  const external = isExternalContactUrl(display);
  return {
    display,
    href: normalizeContactUrl(display),
    target: external ? "_blank" : undefined,
    rel: external ? "noopener noreferrer" : undefined,
  };
};

export const ContactLinks = ({
  fields,
  iconClassName,
}: {
  fields: ContactLinkField[];
  iconClassName: string;
}) => {
  const groups = groupContactFieldsByType(fields);

  return (
    <>
      {groups.map((group) => {
        const Icon = contactFieldIcon(group.type);
        const typeLabel = contactFieldLabel(group.type, "");

        // Single link of this type → open it directly, no popover.
        if (group.fields.length === 1) {
          const { href, target, rel } = resolveLink(group.fields[0].value);
          return (
            <a key={group.type} href={href} target={target} rel={rel} aria-label={typeLabel} title={typeLabel} className={iconClassName}>
              <Icon className="h-4 w-4" />
            </a>
          );
        }

        // Two or more → one icon that opens a popover list of the links.
        return (
          <Popover key={group.type}>
            <PopoverTrigger type="button" aria-label={typeLabel} className={iconClassName}>
              <Icon className="h-4 w-4" />
            </PopoverTrigger>
            {/* Anchored close to the icon (small sideOffset) and kept clear of the
                viewport edges on mobile (collisionPadding); Radix flips it upward in
                the footer automatically. Width hugs the content, capped for small
                screens. */}
            {/* align="start" so the popover opens from the icon's left edge rightward —
                keeps it inside the About card (icons hug the card's left edge) instead
                of a centered popover spilling out the side. */}
            <PopoverContent
              align="start"
              sideOffset={8}
              collisionPadding={12}
              className="w-auto min-w-[11rem] max-w-[min(16rem,calc(100vw-1.5rem))] p-1.5"
            >
              <p className="type-eyebrow px-2 pb-1 pt-1 text-muted-foreground">{typeLabel}</p>
              <div className="flex flex-col">
                {group.fields.map((field) => {
                  const { display, href, target, rel } = resolveLink(field.value);
                  return (
                    <a
                      key={field.id ?? display}
                      href={href}
                      target={target}
                      rel={rel}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-base hover:bg-muted"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{display}</span>
                    </a>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
    </>
  );
};
