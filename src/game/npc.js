import * as THREE from 'three';
import { FIRST_ORDER } from './quest.js';

export class DeliveryNPCs {
  constructor(overlay) {
    this.group = new THREE.Group();
    this.group.name = '配送接待员';
    overlay.add(this.group);
    this.actors = [];
  }

  setPads(pickup, destination) {
    for (const actor of this.actors) actor.traverse((node) => {
      node.geometry?.dispose();
      if (node.material) { node.material.map?.dispose(); node.material.dispose(); }
    });
    this.group.clear();
    this.actors = [];
    for (const [pad, name, color] of [[pickup, FIRST_ORDER.sender, 0x507f79], [destination, FIRST_ORDER.recipient, 0xaf7752]]) {
      if (!pad) continue;
      const actor = new THREE.Group();
      const side = Math.min(pad.radius * 0.6, 0.85);
      actor.position.set(pad.pos.x + Math.cos(pad.yaw) * side, pad.pos.y, pad.pos.z + Math.sin(pad.yaw) * side);
      actor.rotation.y = -pad.yaw;
      const part = (geometry, tint, x, y, z) => {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: tint, roughness: 0.95 }));
        mesh.position.set(x, y, z);
        actor.add(mesh);
        return mesh;
      };
      part(new THREE.CylinderGeometry(0.22, 0.34, 0.82, 8), color, 0, 0.8, 0);
      part(new THREE.SphereGeometry(0.22, 10, 8), 0xe7bc91, 0, 1.42, 0);
      part(new THREE.CylinderGeometry(0.28, 0.29, 0.12, 10), 0xe5d3ae, 0, 1.64, 0);
      for (const x of [-0.13, 0.13]) part(new THREE.BoxGeometry(0.16, 0.42, 0.21), 0x433d36, x, 0.21, 0);
      part(new THREE.BoxGeometry(0.39, 0.26, 0.24), 0xd5b16d, 0, 0.92, -0.28);
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 96;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#18362fe8'; ctx.fillRect(0, 0, 512, 96);
      ctx.strokeStyle = '#d4bc7b'; ctx.strokeRect(2, 2, 508, 92);
      ctx.fillStyle = '#fff8ec'; ctx.font = '30px "PingFang SC", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(name, 256, 48);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true }));
      label.position.y = 2.05; label.scale.set(1.85, 0.35, 1);
      actor.add(label);
      this.group.add(actor);
      this.actors.push(actor);
    }
  }

  update(position) {
    for (const actor of this.actors) actor.visible = actor.position.distanceToSquared(position) < 180 * 180;
  }
}
