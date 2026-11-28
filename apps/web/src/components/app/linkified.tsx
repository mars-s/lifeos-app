import { Fragment } from "react";

export const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

const shortLink = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

export const Linkified = ({ text }: { text: string }) => (
  <>
    {text.split(URL_PATTERN).map((part, index) =>
      index % 2 === 1 ? (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noreferrer"
          title={part}
          className="inline-block max-w-full truncate rounded-sm align-bottom text-foreground/80 underline decoration-foreground/25 underline-offset-[3px] transition-[color,text-decoration-color] duration-(--dur-press) ease-out hover:text-foreground hover:decoration-foreground/60"
          onClick={(event) => event.stopPropagation()}
        >
          {shortLink(part)}
        </a>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    )}
  </>
);

export const TitleLinks = ({ title }: { title: string }) =>
  (title.match(URL_PATTERN) ?? []).map((url) => (
    <p key={url} className="text-small">
      <Linkified text={url} />
    </p>
  ));
