/** Conservative CSSOM candidate index. Complex/escaped selectors fall back to
 * the sampled set so selector syntax cannot cause false-negative evidence. */
export function createStyleIndex(elements:Element[]):(selector:string)=>Element[]{
 const buckets=new Map<string,Element[]>();
 for(const element of elements){const keys=[element.localName.toLowerCase(),...Array.from(element.classList,c=>'.'+c),...(element.id?['#'+element.id]:[])];for(const key of keys){const bucket=buckets.get(key)??[];bucket.push(element);buckets.set(key,bucket);}}
 return selector=>{
  const candidates=new Set<Element>();
  for(const branch of selector.split(',')){
   const text=branch.trim();
   if(!text || !/^(?:[a-zA-Z][\w-]*|\*)?(?:[.#][a-zA-Z_][\w-]*)*$/.test(text))return elements;
   const keys=text.match(/^[a-zA-Z][\w-]*|[.#][a-zA-Z_][\w-]*/g)??[];
   const groups=keys.map(key=>buckets.get(/^[.#]/.test(key)?key:key.toLowerCase())??[]);
   const smallest=groups.length?groups.reduce((a,b)=>a.length<b.length?a:b):elements;
   for(const element of smallest)candidates.add(element);
  }
  return [...candidates];
 };
}
