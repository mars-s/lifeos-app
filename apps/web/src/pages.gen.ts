// deno-fmt-ignore-file
// biome-ignore-all format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse, SearchCodecsForPages } from 'waku/router';

// prettier-ignore
import type { getConfig as File_AppAnytime_getConfig } from './pages/(app)/anytime';
// prettier-ignore
import type { getConfig as File_AppArea_getConfig } from './pages/(app)/area';
// prettier-ignore
import type { getConfig as File_AppInbox_getConfig } from './pages/(app)/inbox';
// prettier-ignore
import type { getConfig as File_AppIndex_getConfig } from './pages/(app)/index';
// prettier-ignore
import type { getConfig as File_AppLogbook_getConfig } from './pages/(app)/logbook';
// prettier-ignore
import type { getConfig as File_AppProject_getConfig } from './pages/(app)/project';
// prettier-ignore
import type { getConfig as File_AppSomeday_getConfig } from './pages/(app)/someday';
// prettier-ignore
import type { getConfig as File_AppToday_getConfig } from './pages/(app)/today';
// prettier-ignore
import type { getConfig as File_AppUpcoming_getConfig } from './pages/(app)/upcoming';
// prettier-ignore
import type { getConfig as File_Design_getConfig } from './pages/design';
// prettier-ignore
import type { getConfig as File_AppLayout_getConfig } from './pages/(app)/_layout';
// prettier-ignore
import type { getConfig as File_Layout_getConfig } from './pages/_layout';

// prettier-ignore
type Page =
| ({ path: '/anytime' } & GetConfigResponse<typeof File_AppAnytime_getConfig>)
| ({ path: '/area' } & GetConfigResponse<typeof File_AppArea_getConfig>)
| ({ path: '/inbox' } & GetConfigResponse<typeof File_AppInbox_getConfig>)
| ({ path: '/' } & GetConfigResponse<typeof File_AppIndex_getConfig>)
| ({ path: '/logbook' } & GetConfigResponse<typeof File_AppLogbook_getConfig>)
| ({ path: '/project' } & GetConfigResponse<typeof File_AppProject_getConfig>)
| ({ path: '/someday' } & GetConfigResponse<typeof File_AppSomeday_getConfig>)
| ({ path: '/today' } & GetConfigResponse<typeof File_AppToday_getConfig>)
| ({ path: '/upcoming' } & GetConfigResponse<typeof File_AppUpcoming_getConfig>)
| ({ path: '/design' } & GetConfigResponse<typeof File_Design_getConfig>);

// prettier-ignore
type Layout =
| ({ path: '/' } & Awaited<ReturnType<typeof File_AppLayout_getConfig>>)
| ({ path: '/' } & Awaited<ReturnType<typeof File_Layout_getConfig>>);

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
    layouts: Layout;
  }
  interface SearchCodecsConfig extends SearchCodecsForPages<Page> {}
}
