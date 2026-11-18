import { Fragment } from "react";

export const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

export const Linkified = ({ text }: { text: string }) => (
  <>
    {text.split(URL_PATTERN).map((part, index) =>
      index % 2 === 1 ? (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm text-brand underline-offset-2 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {part}
        </a>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      ),
    )}
  </>
);

export const TitleLinks = ({ title }: { title: string }) =>
  (title.match(URL_PATTERN) ?? []).map((url) => (
    <p key={url} className="text-small break-all">
      <Linkified text={url} />
    </p>
  ));
