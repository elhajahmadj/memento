import { useEffect, useRef, useState } from "react";
import {
  useGetRecordingNamedUrls,
  getGetRecordingNamedUrlsQueryKey,
} from "@workspace/api-client-react";

export function useNamedUrls(open: boolean) {
  const [startUrl, setStartUrl] = useState("https://example.com");
  const [urlName, setUrlName] = useState("BaseUrl");
  // When the project already has named URLs on disk
  // (`appsettings.json` for C#, `<SOL>_URL_*` keys in `.env` for
  // Node/Python), the dialog defaults to a dropdown of those existing
  // entries so the user can pick "BaseUrl" once and never retype the
  // start URL again. Picking "__add_new__" reveals the original
  // free-text URL/name inputs (which are the only thing shown when the
  // project has nothing on disk yet — preserving the brand-new-project
  // experience verbatim).
  const [urlSelection, setUrlSelection] = useState<string>("__add_new__");
  const namedUrlsQuery = useGetRecordingNamedUrls({
    query: {
      enabled: open,
      staleTime: 0,
      queryKey: getGetRecordingNamedUrlsQueryKey(),
      // 404 = no current project; treat as "no saved URLs" rather than a
      // hard error so the dialog still works.
      retry: false,
    },
  });
  const namedUrls = namedUrlsQuery.data?.urls ?? [];
  const hasNamedUrls = namedUrls.length > 0;
  // When the dialog (re)opens and the project has existing URLs,
  // preselect the first one and prefill the request fields with its
  // value. This is the "existing project, pick from dropdown" default.
  const lastAppliedSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      lastAppliedSelectionRef.current = null;
      return;
    }
    if (!hasNamedUrls) {
      // Brand-new project — keep the legacy free-text inputs visible.
      if (urlSelection !== "__add_new__") setUrlSelection("__add_new__");
      return;
    }
    // Default to the first saved URL the first time the dropdown becomes
    // available; don't clobber a deliberate user selection on re-renders.
    if (lastAppliedSelectionRef.current === null) {
      const first = namedUrls[0]!;
      setUrlSelection(first.name);
      setUrlName(first.name);
      setStartUrl(first.url);
      lastAppliedSelectionRef.current = first.name;
    }
  }, [open, hasNamedUrls, namedUrls, urlSelection]);

  return {
    startUrl,
    setStartUrl,
    urlName,
    setUrlName,
    urlSelection,
    setUrlSelection,
    namedUrls,
    hasNamedUrls,
  };
}
