/* ==========================================================
   DailyJobs — entry point
   Import all modules and expose handlers to the DOM.
   ========================================================== */
import '@material/web/all.js';
import { styles as typescaleStyles } from '@material/web/typography/md-typescale-styles.js';
import './style.css';

import { load, loadConfigFile, saveConfigFile, switchTab } from './lib/ui.js';
import { add, addCustom, toggle, openEdit, saveEditFromDialog, openDelete, doDelFromDialog } from './lib/actions.js';

document.adoptedStyleSheets.push(typescaleStyles.styleSheet);

/* Expose to inline onclick handlers */
window.switchTab          = switchTab;
window.add                = add;
window.addCustom          = addCustom;
window.toggle             = toggle;
window.openEdit           = openEdit;
window.saveEditFromDialog = saveEditFromDialog;
window.openDelete         = openDelete;
window.doDelFromDialog    = doDelFromDialog;
window.loadConfigFile     = loadConfigFile;
window.saveConfigFile     = saveConfigFile;

/* Boot */
loadConfigFile();
load();
