export interface PrivacyCounts { email:number; phone:number; identity:number; address:number }
export interface ExportReview { action:string; counts:PrivacyCounts; downloadsImages?:boolean; screenshot?:boolean }
/** Local heuristics, not identification or a guarantee that data is anonymous.
 * Return counts of distinct matches only; never retain or display match values. */
export function scanPersonalInfo(text:string):PrivacyCounts {
  const count=(pattern:RegExp)=>new Set(text.match(pattern) ?? []).size;
  return {
    email:count(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi),
    phone:count(/(?<!\d)(?:\+?86[ -]?)?1[3-9]\d{9}(?!\d)|(?<!\d)\+\d{1,3}[ -]\d[\d ()-]{6,16}\d(?!\d)/g),
    identity:count(/(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dX](?!\d)/gi),
    address:count(/[\u4e00-\u9fff]{2,12}(?:市|区|县)[\u4e00-\u9fff\d]{2,24}(?:路|街|巷|道)\d{1,6}号(?:\d+[室层楼])?|\b\d{1,6}\s+[A-Z][A-Za-z ]{1,35}\s(?:Street|Road|Avenue|Lane|Drive)\b/gi),
  };
}
