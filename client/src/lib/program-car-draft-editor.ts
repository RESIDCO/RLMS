import { createContext, useContext, useEffect, useRef } from "react";
import { type FlushResult, type ProgramCarDraftSession } from "@/lib/program-car-drafts";

export const ProgramCarDraftContext = createContext<ProgramCarDraftSession | null>(null);

let editorSeq = 0;

/** Register the cell that is currently being typed so Save can read it before blur. */
export function useEditorFlush(pending: boolean, flush: () => FlushResult) {
  const session = useContext(ProgramCarDraftContext);
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = ++editorSeq;
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    if (!session) return;
    return session.register(idRef.current, () => flushRef.current());
  }, [session]);

  useEffect(() => {
    if (!session) return;
    session.setPending(idRef.current, pending);
  }, [session, pending]);

  useEffect(() => {
    if (!session) return;
    const id = idRef.current;
    return () => session.setPending(id, false);
  }, [session]);
}
