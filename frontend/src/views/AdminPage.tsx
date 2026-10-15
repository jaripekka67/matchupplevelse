import type { Backend } from '../backend.ts';
import type { Roles } from '../types.ts';

// Admin-gränssnittet byggs ut i Task 10. Platshållare.
export function AdminPage(_props: { backend: Backend; roles: Roles | null }) {
  return (
    <div>
      <h1>Admin</h1>
      <div className="card">
        Här skapar administratören föreningar och lag och importerar matcher från FOGIS. Byggs i
        nästa steg.
      </div>
    </div>
  );
}
