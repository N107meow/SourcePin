export interface SrcsetCandidate { url: string; descriptor: string }
const SPACE=/[\t\n\f\r ]/;
/** HTML srcset tokenization, retaining the existing single w/x descriptor policy.
 * https://html.spec.whatwg.org/multipage/images.html#parse-a-srcset-attribute
 * This is syntax only: callers must sanitize each URL before emitting or fetching it.
 */
export function parseSrcset(input: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[]=[];
  let position=0;
  while(position<input.length){
    while(position<input.length && (SPACE.test(input[position]) || input[position]===','))position++;
    const start=position;
    while(position<input.length && !SPACE.test(input[position]))position++;
    let url=input.slice(start,position);
    if(!url)break;
    const descriptors:string[]=[];
    if(url.endsWith(','))url=url.replace(/,+$/,'');
    else {
      let token='',parens=false;
      while(position<input.length){
        const char=input[position++];
        if(parens){token+=char;if(char===')')parens=false;}
        else if(char===',')break;
        else if(SPACE.test(char)){if(token){descriptors.push(token);token='';}}
        else {token+=char;if(char==='(')parens=true;}
      }
      if(token)descriptors.push(token);
    }
    if(url && descriptors.length<=1 && (!descriptors.length || /^(?:\d+w|\d+(?:\.\d+)?x)$/.test(descriptors[0])))candidates.push({url,descriptor:descriptors[0]??''});
  }
  return candidates;
}
