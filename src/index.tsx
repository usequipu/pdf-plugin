import type { PluginApi } from './plugin-types';
import PdfViewer from './PdfViewer';

export function init(api: PluginApi): void {
  api.register({
    id: 'pdf-plugin',
    canHandle: (tab) => !!tab.isPdf || tab.name.toLowerCase().endsWith('.pdf'),
    priority: 10,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: PdfViewer as any,
  });
}
