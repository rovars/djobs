/* ==========================================================
   DailyJobs — entry point
   Import all modules and expose handlers to the DOM.
   ========================================================== */
import '@material/web/all.js';
import { styles as typescaleStyles } from '@material/web/typography/md-typescale-styles.js';
import './style.css';

import { load } from './lib/ui.js';
import { add, toggle, openEdit, saveEditFromDialog, openDelete, doDelFromDialog } from './lib/actions.js';

document.adoptedStyleSheets.push(typescaleStyles.styleSheet);

/* Expose to inline onclick handlers */
window.add                = add;
window.toggle             = toggle;
window.openEdit           = openEdit;
window.saveEditFromDialog = saveEditFromDialog;
window.openDelete         = openDelete;
window.doDelFromDialog    = doDelFromDialog;
window.clearAddForm       = () => {
  document.getElementById('new-time').value = '';
  document.getElementById('new-action').value = '';
};

/* Boot — initialise the timeline */
load();
