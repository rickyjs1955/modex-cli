import {
  buildDoc,
  ExtractionError,
  extractSkills,
  readSource,
  serialize,
  SourceError,
} from '@modex/core';

export interface FeedOptions {
  model?: string;
}

export async function runFeed(file: string, opts: FeedOptions): Promise<void> {
  const { content, basename } = await readSource(file);
  const skills = await extractSkills(content, {
    source: basename,
    model: opts.model,
  });
  const out = serialize(buildDoc(skills));
  process.stdout.write(out);
}

export function isUserFacingError(err: unknown): err is Error {
  return err instanceof ExtractionError || err instanceof SourceError;
}
