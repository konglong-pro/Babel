export function GET(): Response {
  return Response.json({ status: "ok", app: "__APP_NAME__" });
}
