/**
 * How a Mall Checker preview load ended, and what the checker is told about it.
 *
 * Kept out of `ObjectViewer.vue` so the wording and the branching can be tested
 * without a browser, an X_ITE build or a GPU. The component supplies the facts;
 * everything here is a pure function of them.
 *
 * The distinction matters to the job. A checker looking at "The 3D viewer could
 * not load this object" cannot tell whether the uploader shipped broken VRML,
 * whether the file never made it to disk, or whether the viewer itself is
 * unwell -- and only the first of those is the uploader's to fix.
 */

/** Why a preview did not reach the point of being displayed. */
export type PreviewFailureKind =
  /** The viewer or the page around it failed; nothing was learned about the object. */
  | "viewer"
  /** The object file was asked for and the server did not return it. */
  | "http"
  /** The file arrived and X_ITE refused it. */
  | "invalid"
  /** Neither outcome arrived in time. */
  | "timeout";

export interface PreviewFailure {
  kind: PreviewFailureKind;
  message: string;
}

/** What the component managed to find out about a load that did not succeed. */
export interface PreviewFailureFacts {
  /** The url the Inline was pointed at. */
  url: string;
  /**
   * HTTP status of a direct request for that url, or null when the check itself
   * could not be made (offline, blocked, aborted). A null status is not
   * evidence of a healthy file, so it must not be reported as a bad object.
   */
  status: number | null;
  /** True when nothing settled and the wait ran out instead. */
  timedOut: boolean;
}

/**
 * Turns what is known into one sentence a checker can act on.
 *
 * Order is deliberate. A timeout is reported as a timeout even if the file
 * fetches cleanly, because "it never finished" is the honest description and
 * blaming the object for it would be wrong. Below that, a bad status explains
 * itself; a good status with no load means the bytes are the problem.
 */
export function describePreviewFailure(facts: PreviewFailureFacts): PreviewFailure {
  if (facts.timedOut) {
    return {
      kind: "timeout",
      message: "The viewer did not finish loading this object in time. "
        + "The file may be very large, or the server may be slow to serve it.",
    };
  }

  if (facts.status !== null && (facts.status < 200 || facts.status >= 400)) {
    return {
      kind: "http",
      message: "The object file could not be fetched: the server answered "
        + `${facts.status} for ${facts.url}. The stored file is missing or unreadable.`,
    };
  }

  if (facts.status === null) {
    return {
      kind: "viewer",
      message: "The viewer could not load this object, and the object file could "
        + "not be checked either. This is a viewer or network problem, not "
        + "necessarily a problem with the upload.",
    };
  }

  return {
    kind: "invalid",
    message: "The object file was served, but the viewer could not read it as VRML. "
      + "The upload is most likely malformed -- see Findings and View Source.",
  };
}

/** Reported when the viewer itself never got far enough to try the object. */
export function viewerFailure(reason: string): PreviewFailure {
  return { kind: "viewer", message: reason };
}

/** What to do with one `isLoaded` report from the object's LoadSensor. */
export type LoadReportVerdict = "loaded" | "failed" | "ignore";

/** Reads one object's `isLoaded` reports in the order they arrive. */
export type LoadReportReader = (loaded: boolean) => LoadReportVerdict;

/**
 * Reads a LoadSensor's `isLoaded` reports for one object.
 *
 * X_ITE runs `LoadSensor.initialize()` from inside `createNode`, and that
 * counts an empty watch list and emits `isLoaded FALSE` before `watchList` has
 * been assigned. The event is queued, so it reaches a callback registered
 * afterwards, and it describes a sensor with nothing to watch rather than the
 * object. Acting on it flashes a load failure over every object in the queue
 * for as long as its model takes to arrive.
 *
 * Only an opening negative is dropped. An opening positive means the model was
 * already there, which is true. A genuine failure cannot be the opening report:
 * the sensor is built in the same turn as the url assignment, so the Inline is
 * still NOT_STARTED and no network result can have arrived yet.
 *
 * One reader per sensor - a new object gets a new sensor and a new reader.
 */
export function loadReportReader(): LoadReportReader {
  let opening = true;
  return (loaded: boolean): LoadReportVerdict => {
    const wasOpening = opening;
    opening = false;
    if (loaded) {
      return "loaded";
    }
    return wasOpening ? "ignore" : "failed";
  };
}
