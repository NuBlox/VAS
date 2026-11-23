/** Cheap integrity check for mismatched editor/published metadata; NOT an authentication token. */
export function projectRevision(project) {
  const text=JSON.stringify({models:project.models,pages:project.pages,workflows:project.workflows});
  let hash=2166136261;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).padStart(8,'0');
}
