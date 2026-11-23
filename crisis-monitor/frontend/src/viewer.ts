/** Who is looking: set by Live OSINT from the signed-in user, read by map cards drawn outside its props (Map3D). */
let admin = false;
export const setViewerIsAdmin = (v: boolean) => {
  admin = v;
};
export const viewerIsAdmin = () => admin;
