import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only intercept eve API routes
  if (!pathname.startsWith("/eve/v1/")) {
    return NextResponse.next();
  }

  const password = process.env.ROUTE_AUTH_PASSWORD;
  if (!password) {
    return NextResponse.next();
  }

  const token = Buffer.from(`admin:${password}`).toString("base64");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("authorization", `Basic ${token}`);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: "/eve/v1/:path*",
};
