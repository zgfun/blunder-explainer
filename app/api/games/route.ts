import { z } from "zod";
import { CHESSCOM_HTTP_STATUS, ChessComError, listRecentGames, USERNAME_RE } from "@/lib/chesscom";

export const maxDuration = 30;

const query = z.object({ username: z.string().trim().regex(USERNAME_RE) });

export async function GET(request: Request) {
  const q = query.safeParse({ username: new URL(request.url).searchParams.get("username") ?? "" });
  if (!q.success) {
    return Response.json(
      { error: "invalid-username", message: "Usernames are 3-25 letters, digits, '_' or '-'." },
      { status: 400 },
    );
  }
  try {
    return Response.json({ games: await listRecentGames(q.data.username) });
  } catch (e) {
    if (e instanceof ChessComError) {
      return Response.json({ error: e.code, message: e.message }, { status: CHESSCOM_HTTP_STATUS[e.code] });
    }
    return Response.json({ error: "upstream", message: "Something went wrong talking to chess.com." }, { status: 502 });
  }
}
