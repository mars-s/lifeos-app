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
import type { getConfig as File_AppNotes_getConfig } from './pages/(app)/notes';
// prettier-ignore
import type { getConfig as File_AppPlanner_getConfig } from './pages/(app)/planner';
// prettier-ignore
import type { getConfig as File_AppProject_getConfig } from './pages/(app)/project';
// prettier-ignore
import type { getConfig as File_AppSettings_getConfig } from './pages/(app)/settings';
// prettier-ignore
import type { getConfig as File_AppSettingsFeaturesFeature_getConfig } from './pages/(app)/settings/features/[feature]';
// prettier-ignore
import type { getConfig as File_AppSomeday_getConfig } from './pages/(app)/someday';
// prettier-ignore
import type { getConfig as File_AppTemplates_getConfig } from './pages/(app)/templates';
// prettier-ignore
import type { getConfig as File_AppToday_getConfig } from './pages/(app)/today';
// prettier-ignore
import type { getConfig as File_AppTrash_getConfig } from './pages/(app)/trash';
// prettier-ignore
import type { getConfig as File_AppUpcoming_getConfig } from './pages/(app)/upcoming';
// prettier-ignore
import type { getConfig as File_Capture_getConfig } from './pages/capture';
// prettier-ignore
import type { getConfig as File_Connect_getConfig } from './pages/connect';
// prettier-ignore
import type { getConfig as File_Design_getConfig } from './pages/design';
// prettier-ignore
import type { getConfig as File_DesignAi_getConfig } from './pages/design/ai';
// prettier-ignore
import type { getConfig as File_DesignCanvas_getConfig } from './pages/design/canvas';
// prettier-ignore
import type { getConfig as File_DesignNotes_getConfig } from './pages/design/notes';
// prettier-ignore
import type { getConfig as File_DesignWidgets_getConfig } from './pages/design/widgets';
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
| ({ path: '/notes' } & GetConfigResponse<typeof File_AppNotes_getConfig>)
| ({ path: '/planner' } & GetConfigResponse<typeof File_AppPlanner_getConfig>)
| ({ path: '/project' } & GetConfigResponse<typeof File_AppProject_getConfig>)
| ({ path: '/settings' } & GetConfigResponse<typeof File_AppSettings_getConfig>)
| ({ path: '/settings/features/[feature]' } & GetConfigResponse<typeof File_AppSettingsFeaturesFeature_getConfig>)
| ({ path: '/someday' } & GetConfigResponse<typeof File_AppSomeday_getConfig>)
| ({ path: '/templates' } & GetConfigResponse<typeof File_AppTemplates_getConfig>)
| ({ path: '/today' } & GetConfigResponse<typeof File_AppToday_getConfig>)
| ({ path: '/trash' } & GetConfigResponse<typeof File_AppTrash_getConfig>)
| ({ path: '/upcoming' } & GetConfigResponse<typeof File_AppUpcoming_getConfig>)
| ({ path: '/capture' } & GetConfigResponse<typeof File_Capture_getConfig>)
| ({ path: '/connect' } & GetConfigResponse<typeof File_Connect_getConfig>)
| ({ path: '/design' } & GetConfigResponse<typeof File_Design_getConfig>)
| ({ path: '/design/ai' } & GetConfigResponse<typeof File_DesignAi_getConfig>)
| ({ path: '/design/canvas' } & GetConfigResponse<typeof File_DesignCanvas_getConfig>)
| ({ path: '/design/notes' } & GetConfigResponse<typeof File_DesignNotes_getConfig>)
| ({ path: '/design/widgets' } & GetConfigResponse<typeof File_DesignWidgets_getConfig>);

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
