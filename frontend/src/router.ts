// Hash-baserad routing. Ren logik, testbar utan DOM.
//
// Adresser:
//   #/              -> mina lag (startsida)
//   #/team/<id>     -> ett lags matcher (lagledarens rapportering)
//   #/admin         -> admin-gränssnittet
//   #/forbund       -> förbundsrepresentantens vy
//   okänt           -> mina lag

export type Route =
  | { kind: 'home' }
  | { kind: 'team'; teamId: string }
  | { kind: 'admin' }
  | { kind: 'federation' };

export function parseRoute(hash: string): Route {
  // Normalisera: ta bort inledande '#', '/', och trailing '/'.
  const raw = hash.replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  const parts = raw.split('/').filter(Boolean);

  if (parts.length === 0) return { kind: 'home' };

  switch (parts[0]) {
    case 'team':
      if (parts[1]) return { kind: 'team', teamId: parts[1] };
      return { kind: 'home' };
    case 'admin':
      return { kind: 'admin' };
    case 'forbund':
      return { kind: 'federation' };
    default:
      return { kind: 'home' };
  }
}

export function routeHash(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '#/';
    case 'team':
      return `#/team/${route.teamId}`;
    case 'admin':
      return '#/admin';
    case 'federation':
      return '#/forbund';
  }
}
