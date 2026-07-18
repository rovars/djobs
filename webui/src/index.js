/* ==========================================================
   DailyJobs — entry point
   ========================================================== */
import '@material/web/all.js';
import { styles as typescaleStyles } from '@material/web/typography/md-typescale-styles.js';
import './style.css';

import { load } from './lib/ui.js';
import { add, toggle, openEdit, saveEditFromDialog, deleteFromEdit, openDelete, doDelFromDialog, clearAddForm } from './lib/actions.js';

document.adoptedStyleSheets.push(typescaleStyles.styleSheet);

window.add                = add;
window.toggle             = toggle;
window.openEdit           = openEdit;
window.saveEditFromDialog = saveEditFromDialog;
window.deleteFromEdit     = deleteFromEdit;
window.openDelete         = openDelete;
window.doDelFromDialog    = doDelFromDialog;
window.clearAddForm       = clearAddForm;

load();
