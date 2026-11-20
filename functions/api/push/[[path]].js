import { handlePushApi } from '../../_lib/pushApi.js';

/** Cloudflare Pages Function: /api/push/* */
export async function onRequest(context) {
  return handlePushApi(context.request, context.env);
}
