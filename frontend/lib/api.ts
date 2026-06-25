/** Type definitions + re-exports for the client-side API layer.
 *
 * The actual data lives in `localStorage` (see `lib/store.ts`) and is read
 * / written directly by the page components. Google API calls happen
 * client-side via `lib/google-client.ts`. There is no server.
 */

export interface AuthStatus {
  signed_in: boolean;
  email?: string | null;
  has_credentials?: boolean;
  google_sub?: string | null;
}

export interface GoogleCredentialsStatus {
  has_db_overrides: boolean;
  client_id: string | null;
  client_secret_set: boolean;
  redirect_uri: string;
}

export interface Property {
  site_url: string;
  permission_level: string;
  last_synced: string;
}

export interface Quota {
  date: string;
  used: number;
  limit: number;
  remaining: number;
}

export interface Batch {
  id: number;
  name: string | null;
  property_url: string;
  publish_type: "URL_UPDATED" | "URL_DELETED";
  total: number;
  pending: number;
  processing: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  created_at: string;
}

export interface BatchDetail extends Batch {
  jobs: Array<
    Pick<
      Job,
      | "id"
      | "url"
      | "status"
      | "attempts"
      | "last_error"
      | "http_status"
      | "google_notify_time"
      | "submitted_at"
      | "completed_at"
    >
  >;
}

export interface Job {
  id: number;
  batch_id: number;
  url: string;
  property_url: string;
  publish_type: "URL_UPDATED" | "URL_DELETED";
  status: "pending" | "processing" | "submitted" | "failed" | "cancelled";
  attempts: number;
  last_error: string | null;
  http_status: number | null;
  google_notify_time: string | null;
  created_at: string;
  submitted_at: string | null;
  completed_at: string | null;
}

export type JobStatus = Job["status"];
export type PublishType = Job["publish_type"];

export interface RecentlySubmitted {
  url: string;
  property_url: string;
  status: "submitted" | "processing" | "pending";
  last_submitted_at: string | null;
  last_seen_at: string;
  batch_id: number;
}

export interface CreateBatchResponse {
  batch_ids: number[];
  total_urls: number;
  recently_submitted: RecentlySubmitted[];
}
