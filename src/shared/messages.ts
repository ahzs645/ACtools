export interface AvailabilityDraft {
  employeeId: number;
  availabilityTypeId: number;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
}

export interface PageStatus {
  ready: boolean;
  location: string;
  reason?: string;
  currentUserId?: number;
  currentUserName?: string;
}

export interface AvailabilityPostResult {
  uri: string;
  status: number;
  body: unknown;
}

export interface CommandResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export type RuntimeMessage =
  | {
      type: "ac/popup/get-status";
    }
  | {
      type: "ac/popup/open-day-view";
    }
  | {
      type: "ac/popup/post-availability";
      payload: AvailabilityDraft;
    }
  | {
      type: "ac/content/get-status";
    }
  | {
      type: "ac/content/open-day-view";
    }
  | {
      type: "ac/content/post-availability";
      payload: AvailabilityDraft;
    };

export const POPUP_FORM_STORAGE_KEY = "ac-tools-availability-draft";

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeType = (value as { type?: unknown }).type;
  return typeof maybeType === "string" && maybeType.startsWith("ac/");
}

export function isPopupMessage(
  value: RuntimeMessage
): value is Extract<RuntimeMessage, { type: `ac/popup/${string}` }> {
  return value.type.startsWith("ac/popup/");
}

export function isContentMessage(
  value: RuntimeMessage
): value is Extract<RuntimeMessage, { type: `ac/content/${string}` }> {
  return value.type.startsWith("ac/content/");
}
