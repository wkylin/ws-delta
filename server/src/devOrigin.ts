function parseIpv4(hostname: string): number[] | null {
  const segments = hostname.split(".");
  if (segments.length !== 4) return null;

  const numbers = segments.map((segment) => Number(segment));
  if (
    numbers.some(
      (value, index) =>
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255 ||
        String(value) !== segments[index],
    )
  ) {
    return null;
  }
  return numbers;
}

function isLocalOrPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  ) {
    return true;
  }

  const ipv4 = parseIpv4(normalized);
  if (!ipv4) return false;
  const [first, second] = ipv4;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function isAllowedMockDevelopmentOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (
    parsed.protocol !== "http:" ||
    !isLocalOrPrivateHostname(parsed.hostname)
  ) {
    return false;
  }

  const port = Number(parsed.port);
  return Number.isInteger(port) && port >= 5173 && port <= 5199;
}
