export type Outcome = "recovered" | "cancelled" | "declined" | "referred_to_tow";

export type ResponderStatus = "responding" | "cant_make_it";

export type RecoveryStatus = "open" | "closed";

export type PhotoNote = {
  source: string;
  reason: string;
};

export type Recovery = {
  id: string;
  requesterName: string;
  phone: string;
  lat: number;
  lon: number;
  injuries: string;
  vehicle: string;
  situation: string;
  county: string;
  photoUrls: string[];
  attachmentNotes: PhotoNote[];
  attachedPhotoCount: number;
  publicChannelId: string | null;
  publicMessageId: string | null;
  threadId: string | null;
  rosterMessageId: string | null;
  closeoutMessageId: string | null;
  status: RecoveryStatus;
  outcome: Outcome | null;
  closedByDiscordId: string | null;
  closedByName: string | null;
  closedAt: string | null;
  createdAt: string;
};

export type Responder = {
  recoveryId: string;
  discordUserId: string;
  discordUsername: string;
  displayName: string;
  status: ResponderStatus;
  createdAt: string;
  updatedAt: string;
};

export type Actor = {
  id: string;
  username: string;
  displayName: string;
  roles: string[];
};

export type Upload = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

export type IntakeInput = {
  idempotencyKey: string;
  requesterName: string;
  phone: string;
  lat: number;
  lon: number;
  injuries: string;
  vehicle: string;
  situation: string;
  county: string;
  photoUrls: string[];
  uploads: Upload[];
};

export type IntakeSuccess = {
  recoveryId: string;
  publicMessageId: string;
  threadId: string;
  attachedPhotos: number;
  skippedPhotos: number;
  skipped: PhotoNote[];
};

export type DiscordUser = {
  id: string;
  username?: string;
  global_name?: string | null;
};

export type DiscordInteraction = {
  type: number;
  id?: string;
  token?: string;
  channel_id?: string;
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
    options?: { name?: string; type?: number; value?: string }[];
  };
  member?: {
    nick?: string | null;
    roles?: string[];
    user?: DiscordUser;
  };
  user?: DiscordUser;
};

export type SheetKind = "claim" | "outcome";

export type OutgoingFile = {
  filename: string;
  bytes: Uint8Array;
  contentType: string;
};

export type OutgoingMessage = {
  content: string;
  components?: ComponentRow[];
  files?: OutgoingFile[];
};

export type ButtonSpec = {
  customId: string;
  label: string;
  style: number;
  disabled?: boolean;
};

export type ComponentRow = {
  type: 1;
  components: {
    type: 2;
    style: number;
    label: string;
    custom_id: string;
    disabled: boolean;
  }[];
};
