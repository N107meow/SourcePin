/** Confirms the export review when it appears.
 *
 * The review dialog opens once per activation, and again whenever the snapshot
 * carries personal information or the export is a screenshot. A helper that
 * always waited for it would hang on every later export in the same activation,
 * so this returns false when no review was due. Waiting on the export outcome
 * stays the caller's job.
 */
export async function confirmExport(page,timeout=2000){
 const button=page.locator('[data-action="export-confirm"]');
 try{
  await button.waitFor({state:'visible',timeout});
 }catch{
  return false;
 }
 await button.click();
 return true;
}
