import { NodeIO } from '@gltf-transform/core';
const path = process.argv[2] || 'public/models/token-tophat.glb';
const io = new NodeIO();
const doc = await io.read(path);
const root = doc.getRoot();
let tris=0, verts=0, meshes=0;
const nodes = root.listNodes().length;
const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
for (const m of root.listMeshes()) { meshes++;
  for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    verts += pos ? pos.getCount() : 0;
    const idx = p.getIndices();
    tris += idx ? idx.getCount()/3 : (pos?pos.getCount()/3:0);
    if (pos) {
      const acc=[0,0,0];
      for (let i=0;i<pos.getCount();i++){pos.getElement(i,acc);for(let k=0;k<3;k++){min[k]=Math.min(min[k],acc[k]);max[k]=Math.max(max[k],acc[k]);}}
    }
    console.log('  has COLOR_0', !!p.getAttribute('COLOR_0'), 'has NORMAL', !!p.getAttribute('NORMAL'));
  }
}
console.log('bounds min', min.map(x=>x.toFixed(3)), 'max', max.map(x=>x.toFixed(3)));
console.log('size', max.map((v,i)=>(v-min[i]).toFixed(3)));
console.log({nodes, meshes, verts, tris});
