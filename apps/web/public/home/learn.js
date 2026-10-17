// The worked examples on the home page: a bank line reconciled, and an invoice
// matched to its payment, with the ledger drawn as a balance.
(function() {
  function createScaleEngine(canvasId, getSubtitlesFn) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');

    const pivotX = 530;
    const pivotY = 108;
    const armLength = 250;
    const hangerDrop = 118;
    const trayWidth = 184;

    const state = { balls: [], currentAngle: 0, targetAngle: 0, angularVelocity: 0 };

    function getRadius(amount) {
      return Math.max(17, Math.min(33, 9.5 + Math.sqrt(amount) * 1.32));
    }

    function spawnOrb({ side, amount, code, label, color, isAR = false, gstPending = false, dropFromTop = true }) {
      const tipX = side === 'left' ? pivotX - armLength : pivotX + armLength;
      const r = getRadius(amount);
      const sameSideCount = state.balls.filter(b => b.side === side).length;
      const slots = [-42, 42, 0, -24, 24];
      const slotOffset = slots[sameSideCount % slots.length] + (Math.random() - 0.5) * 6;

      const startTipY = pivotY - Math.sin(state.currentAngle) * (side === 'left' ? armLength : -armLength);
      const startFloorY = startTipY + hangerDrop - 5;

      state.balls.push({
        side, amount, code, label, color, isAR, gstPending, cleared: false, r,
        x: tipX + slotOffset,
        y: dropFromTop ? 16 - Math.random() * 14 : startFloorY - r,
        vx: 0,
        vy: dropFromTop ? 1.5 : 0
      });
    }

    function tick() {
      const prevAngle = state.currentAngle;
      const springK = 0.045;
      const damping = 0.82;
      state.angularVelocity = (state.angularVelocity + (state.targetAngle - state.currentAngle) * springK) * damping;
      if (Math.abs(state.targetAngle - state.currentAngle) < 0.0003 && Math.abs(state.angularVelocity) < 0.0003) {
        state.currentAngle = state.targetAngle;
        state.angularVelocity = 0;
      } else {
        state.currentAngle += state.angularVelocity;
      }

      const prevLeftTipX = pivotX - Math.cos(prevAngle) * armLength;
      const prevLeftTipY = pivotY - Math.sin(prevAngle) * armLength;
      const prevRightTipX = pivotX + Math.cos(prevAngle) * armLength;
      const prevRightTipY = pivotY + Math.sin(prevAngle) * armLength;

      const leftTipX = pivotX - Math.cos(state.currentAngle) * armLength;
      const leftTipY = pivotY - Math.sin(state.currentAngle) * armLength;
      const leftTrayX = leftTipX;
      const leftTrayY = leftTipY + hangerDrop;

      const rightTipX = pivotX + Math.cos(state.currentAngle) * armLength;
      const rightTipY = pivotY + Math.sin(state.currentAngle) * armLength;
      const rightTrayX = rightTipX;
      const rightTrayY = rightTipY + hangerDrop;

      const dLeftX = leftTipX - prevLeftTipX;
      const dLeftY = leftTipY - prevLeftTipY;
      const dRightX = rightTipX - prevRightTipX;
      const dRightY = rightTipY - prevRightTipY;

      for (let i = 0; i < state.balls.length; i++) {
        const b = state.balls[i];
        const trayX = b.side === 'left' ? leftTrayX : rightTrayX;
        const trayY = b.side === 'left' ? leftTrayY : rightTrayY;
        const floorY = trayY - 5;
        const halfW = trayWidth / 2 - 14;

        if (b.y + b.r >= floorY - 3) {
          b.x += (b.side === 'left' ? dLeftX : dRightX);
          b.y += (b.side === 'left' ? dLeftY : dRightY);
        }

        if (b.y + b.r < floorY - 0.5) b.vy += 0.42;
        b.vx *= 0.88;
        b.x += b.vx;
        b.y += b.vy;

        if (b.y + b.r >= floorY) {
          b.y = floorY - b.r;
          b.vy = Math.abs(b.vy) > 1.35 ? -b.vy * 0.22 : 0;
          b.vx *= 0.75;
          if (Math.abs(b.vx) < 0.12) b.vx = 0;
        }

        if (b.x - b.r < trayX - halfW) {
          b.x = trayX - halfW + b.r;
          b.vx = Math.abs(b.vx) * 0.3;
        } else if (b.x + b.r > trayX + halfW) {
          b.x = trayX + halfW - b.r;
          b.vx = -Math.abs(b.vx) * 0.3;
        }
      }

      for (let iter = 0; iter < 4; iter++) {
        for (let i = 0; i < state.balls.length; i++) {
          for (let j = i + 1; j < state.balls.length; j++) {
            const b1 = state.balls[i];
            const b2 = state.balls[j];
            if (b1.side !== b2.side) continue;

            const dx = b2.x - b1.x;
            const dy = b2.y - b1.y;
            const dist = Math.hypot(dx, dy);
            const minDist = b1.r + b2.r + 1.5;

            if (dist < minDist && dist > 0.001) {
              const nx = dx / dist;
              const ny = dy / dist;
              const overlap = minDist - dist;

              b1.x -= nx * overlap * 0.5;
              b1.y -= ny * overlap * 0.5;
              b2.x += nx * overlap * 0.5;
              b2.y += ny * overlap * 0.5;

              const relVel = nx * (b1.vx - b2.vx) + ny * (b1.vy - b2.vy);
              if (relVel > 0) {
                b1.vx -= relVel * nx * 0.35;
                b1.vy -= relVel * ny * 0.35;
                b2.vx += relVel * nx * 0.35;
                b2.vy += relVel * ny * 0.35;
              }
            }
          }

          const b = state.balls[i];
          const trayX = b.side === 'left' ? leftTrayX : rightTrayX;
          const floorY = (b.side === 'left' ? leftTrayY : rightTrayY) - 5;
          const halfW = trayWidth / 2 - 14;

          if (b.y + b.r > floorY) { b.y = floorY - b.r; if (b.vy > 0) b.vy = 0; }
          if (b.x - b.r < trayX - halfW) { b.x = trayX - halfW + b.r; b.vx = 0; }
          else if (b.x + b.r > trayX + halfW) { b.x = trayX + halfW - b.r; b.vx = 0; }

          if (Math.abs(b.vx) < 0.08) b.vx = 0;
          if (Math.abs(b.vy) < 0.08 && b.y + b.r >= floorY - 1) b.vy = 0;
        }
      }

      draw(leftTipX, leftTipY, leftTrayX, leftTrayY, rightTipX, rightTipY, rightTrayX, rightTrayY);
      requestAnimationFrame(tick);
    }

    function drawTray(tipX, tipY, trayX, trayY, title, subtitle, isBalanced) {
      const halfW = trayWidth / 2;
      ctx.save();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(tipX, tipY); ctx.lineTo(trayX - halfW + 8, trayY - 20);
      ctx.moveTo(tipX, tipY); ctx.lineTo(trayX + halfW - 8, trayY - 20);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#0284c7';
      ctx.beginPath(); ctx.arc(tipX, tipY, 4.5, 0, Math.PI * 2); ctx.fill();

      const dishGrad = ctx.createLinearGradient(trayX - halfW, trayY - 24, trayX + halfW, trayY + 4);
      dishGrad.addColorStop(0, 'rgba(226, 232, 240, 0.55)');
      dishGrad.addColorStop(0.5, 'rgba(241, 245, 249, 0.35)');
      dishGrad.addColorStop(1, 'rgba(203, 213, 225, 0.65)');
      ctx.fillStyle = dishGrad;
      ctx.strokeStyle = isBalanced ? '#16a34a' : '#64748b';
      ctx.lineWidth = 2.2;

      ctx.beginPath();
      ctx.moveTo(trayX - halfW, trayY - 22);
      ctx.quadraticCurveTo(trayX - halfW + 6, trayY, trayX - halfW + 22, trayY);
      ctx.lineTo(trayX + halfW - 22, trayY);
      ctx.quadraticCurveTo(trayX + halfW - 6, trayY, trayX + halfW, trayY - 22);
      ctx.stroke(); ctx.fill();

      ctx.fillStyle = isBalanced ? '#16a34a' : '#475569';
      ctx.beginPath(); ctx.roundRect(trayX - halfW + 20, trayY, trayWidth - 40, 4.5, 2); ctx.fill();

      ctx.fillStyle = '#1e293b';
      ctx.font = '700 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(title, trayX, trayY + 19);
      ctx.fillStyle = '#64748b';
      ctx.font = '500 10px sans-serif'; ctx.fillText(subtitle, trayX, trayY + 32);
      ctx.restore();
    }

    function draw(leftTipX, leftTipY, leftTrayX, leftTrayY, rightTipX, rightTipY, rightTrayX, rightTrayY) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const isBalanced = Math.abs(state.targetAngle) < 0.005 && Math.abs(state.currentAngle) < 0.015 && state.balls.length > 0;

      ctx.save();
      ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pivotX, pivotY, 56, Math.PI * 0.25, Math.PI * 0.75); ctx.stroke();

      for (let a = -0.4; a <= 0.401; a += 0.1) {
        const angle = Math.PI * 0.5 + a;
        ctx.strokeStyle = Math.abs(a) < 0.01 ? '#16a34a' : '#94a3b8';
        ctx.lineWidth = Math.abs(a) < 0.01 ? 2.5 : 1.2;
        ctx.beginPath();
        ctx.moveTo(pivotX + Math.cos(angle) * (Math.abs(a) < 0.01 ? 45 : 50), pivotY + Math.sin(angle) * (Math.abs(a) < 0.01 ? 45 : 50));
        ctx.lineTo(pivotX + Math.cos(angle) * 56, pivotY + Math.sin(angle) * 56);
        ctx.stroke();
      }

      const colGrad = ctx.createLinearGradient(pivotX - 16, pivotY, pivotX + 16, pivotY);
      colGrad.addColorStop(0, '#94a3b8'); colGrad.addColorStop(0.5, '#cbd5e1'); colGrad.addColorStop(1, '#64748b');
      ctx.fillStyle = colGrad;
      ctx.beginPath(); ctx.moveTo(pivotX - 7, pivotY); ctx.lineTo(pivotX - 18, 316); ctx.lineTo(pivotX + 18, 316); ctx.lineTo(pivotX + 7, pivotY); ctx.closePath(); ctx.fill();

      ctx.fillStyle = '#475569';
      ctx.beginPath(); ctx.roundRect(pivotX - 58, 316, 116, 12, [5, 5, 0, 0]); ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(pivotX, pivotY); ctx.rotate(state.currentAngle);
      const beamGrad = ctx.createLinearGradient(0, -9, 0, 9);
      if (isBalanced) { beamGrad.addColorStop(0, '#22c55e'); beamGrad.addColorStop(1, '#15803d'); }
      else { beamGrad.addColorStop(0, '#64748b'); beamGrad.addColorStop(1, '#334155'); }
      ctx.fillStyle = beamGrad;
      ctx.beginPath(); ctx.moveTo(-armLength - 5, 0); ctx.lineTo(0, -10); ctx.lineTo(armLength + 5, 0); ctx.lineTo(0, 10); ctx.closePath(); ctx.fill();

      ctx.strokeStyle = isBalanced ? '#16a34a' : '#d97706'; ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 48); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3.5; ctx.strokeStyle = isBalanced ? '#16a34a' : '#0284c7'; ctx.stroke();
      ctx.restore();

      const leftTotal = state.balls.filter(b => b.side === 'left').reduce((s, b) => s + b.amount, 0);
      const rightTotal = state.balls.filter(b => b.side === 'right').reduce((s, b) => s + b.amount, 0);
      const subs = getSubtitlesFn();

      drawTray(leftTipX, leftTipY, leftTrayX, leftTrayY, `DEBITS (${leftTotal.toFixed(2)})`, subs.left, isBalanced);
      drawTray(rightTipX, rightTipY, rightTrayX, rightTrayY, `CREDITS (${rightTotal.toFixed(2)})`, subs.right, isBalanced);

      state.balls.forEach(b => {
        ctx.save();
        if (b.cleared) {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.12)'; ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#15803d'; ctx.font = '700 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('AR $0', b.x, b.y - 4); ctx.font = '600 8px sans-serif'; ctx.fillText('CLEARED ✓', b.x, b.y + 7);
        } else if (b.gstPending) {
          ctx.fillStyle = 'rgba(99, 102, 241, 0.16)'; ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 2;
          ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#4338ca'; ctx.font = '700 9.5px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(b.label, b.x, b.y - 4); ctx.font = '600 7.5px sans-serif'; ctx.fillText('UNPAID GST', b.x, b.y + 6);
        } else {
          const grad = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.1, b.x, b.y, b.r);
          grad.addColorStop(0, 'rgba(255,255,255,0.45)'); grad.addColorStop(0.25, b.color); grad.addColorStop(1, '#0f172a');
          ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffffff'; ctx.font = `700 ${b.r > 22 ? '10.5px' : '9px'} sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(b.label, b.x, b.y - 4);
          ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.font = '600 8px sans-serif'; ctx.fillText(b.code, b.x, b.y + 7);
        }
        ctx.restore();
      });
    }

    requestAnimationFrame(tick);
    return { state, spawnOrb };
  }

  // --- INSTANCE 1 ---
  const scale1 = createScaleEngine('canvasNormal', () => ({ left: 'Bank Debits (Landed Earlier)', right: '200 Sales + 820 GST' }));
  const s1Initial = [
    { id: 1, date: "2026-10-15", payer: "CHEN, LIAM Liam Chen", amount: 165.00, bankAcct: "12-3456-0123456-00", revAcct: "200 Sales", net: 143.48, gst: 21.52, reconciled: false },
    { id: 2, date: "2026-10-16", payer: "PATEL, ARJUN Arjun Patel", amount: 345.00, bankAcct: "12-3456-0123456-00", revAcct: "200 Sales", net: 300.00, gst: 45.00, reconciled: false }
  ];
  const s1ExtraPool = [
    { payer: "KOWALSKI, ELENA Elena Kowalski", amount: 115.00, net: 100.00, gst: 15.00 },
    { payer: "MORRISON, TARA Tara Morrison", amount: 230.00, net: 200.00, gst: 30.00 }
  ];
  let s1PoolIdx = 0;
  let s1Txs = [];

  window.s1Reset = function() {
    s1Txs = JSON.parse(JSON.stringify(s1Initial));
    scale1.state.balls = [];
    scale1.state.currentAngle = -0.22;
    scale1.state.angularVelocity = 0;
    s1Txs.forEach(tx => scale1.spawnOrb({ side: 'left', amount: tx.amount, code: 'Bank Dr', label: tx.amount.toFixed(2), color: '#0284c7', dropFromTop: false }));
    s1Render();
  };

  function s1Render() {
    const totalDr = s1Txs.reduce((s, t) => s + t.amount, 0);
    const rec = s1Txs.filter(t => t.reconciled);
    const totalCr = rec.reduce((s, t) => s + t.amount, 0);
    const variance = Math.abs(totalDr - totalCr);

    document.getElementById('s1Dr').textContent = totalDr.toFixed(2);
    document.getElementById('s1Cr').textContent = totalCr.toFixed(2);
    const stEl = document.getElementById('s1Status');
    if (variance < 0.01) { stEl.textContent = '0.00 BALANCED ✓'; stEl.style.color = 'var(--tick-green)'; }
    else { stEl.textContent = `${variance.toFixed(2)} UNRECONCILED`; stEl.style.color = 'var(--ar-amber)'; }

    scale1.state.targetAngle = Math.max(-0.23, Math.min(0.23, ((totalCr - totalDr) / Math.max(totalDr, 1)) * 0.25));

    const tbody = document.getElementById('s1TableBody');
    tbody.innerHTML = '';
    s1Txs.forEach(tx => {
      const crClass = tx.reconciled ? 'nzosa-pending posted' : 'nzosa-pending';
      const btnClass = tx.reconciled ? 'nzosa-tick reconciled' : 'nzosa-tick pulse';
      const parts = tx.payer.split(' ');

      tbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td>${tx.date.slice(0, 8)}<br>${tx.date.slice(8)}</td>
          <td><strong>${parts.slice(0, 2).join(' ')}</strong><br><span style="color:var(--text-muted)">${parts.slice(2).join(' ')}</span></td>
          <td class="num" style="font-weight:600">${tx.amount.toFixed(2)}</td>
          <td class="center"><button class="${btnClass}" data-learn="s1ReconcileOne" data-arg="${tx.id}" title="Click ✓ to Reconcile">✓</button></td>
          <td>${tx.bankAcct} ${tx.bankAcct.slice(0, 15)}-<br>${tx.bankAcct.slice(16)}</td>
          <td class="num" style="font-weight:600; color:var(--bank-blue)">${tx.amount.toFixed(2)}</td>
          <td class="num"></td>
        </tr>
        <tr>
          <td></td><td></td><td></td><td></td>
          <td class="${crClass}"><i class="nzosa-dot" style="background:var(--sales-teal)"></i>${tx.revAcct}</td>
          <td class="num"></td><td class="num ${crClass}" style="font-weight:600; color:var(--sales-teal)">${tx.net.toFixed(2)}</td>
        </tr>
        <tr class="group-end">
          <td></td><td></td><td></td><td></td>
          <td class="${crClass}"><i class="nzosa-dot" style="background:var(--gst-indigo)"></i>820 GST <span class="nzosa-badge green">Cash Basis Paid</span></td>
          <td class="num"></td><td class="num ${crClass}" style="font-weight:600; color:var(--gst-indigo)">${tx.gst.toFixed(2)}</td>
        </tr>
      `);
    });
  }

  window.s1ReconcileOne = function(id) {
    const tx = s1Txs.find(t => t.id === id);
    if (!tx || tx.reconciled) return;
    tx.reconciled = true;
    s1Render();
    scale1.spawnOrb({ side: 'right', amount: tx.net, code: '200 Sales', label: tx.net.toFixed(2), color: '#0d9488' });
    setTimeout(() => scale1.spawnOrb({ side: 'right', amount: tx.gst, code: '820 GST', label: tx.gst.toFixed(2), color: '#6366f1' }), 100);
  };

  window.s1SpawnBankLine = function() {
    const tpl = s1ExtraPool[s1PoolIdx % s1ExtraPool.length];
    s1PoolIdx++;
    const newTx = { id: Date.now() + Math.random(), date: "2026-10-16", payer: tpl.payer, amount: tpl.amount, bankAcct: "12-3456-0123456-00", revAcct: "200 Sales", net: tpl.net, gst: tpl.gst, reconciled: false };
    s1Txs.push(newTx);
    s1Render();
    scale1.spawnOrb({ side: 'left', amount: newTx.amount, code: 'Bank Dr', label: newTx.amount.toFixed(2), color: '#0284c7', dropFromTop: true });
  };


  // --- INSTANCE 2 ---
  const scale2 = createScaleEngine('canvasInvoice', () => ({ left: '610 AR Dr + Bank Dr', right: '200 Sales + 820 GST + 610 AR Cr' }));
  let s2Stage = 0;

  window.s2Reset = function() {
    s2Stage = 0;
    scale2.state.balls = [];
    scale2.state.currentAngle = 0;
    scale2.state.targetAngle = 0;
    scale2.state.angularVelocity = 0;

    const b1 = document.getElementById('btnInv1');
    b1.className = 'nzosa-btn primary'; b1.innerHTML = '1. Enter Invoice (INV-0049)'; b1.disabled = false;
    const b2 = document.getElementById('btnInv2');
    b2.className = 'nzosa-btn'; b2.innerHTML = '2. Bank Payment Lands ($225.00)'; b2.disabled = true;
    const b3 = document.getElementById('btnInv3');
    b3.className = 'nzosa-btn status-only'; b3.innerHTML = '3. Match the invoice, ✓ to clear AR (Click ✓ below)'; b3.setAttribute('disabled', 'disabled');

    document.getElementById('s2Dr').textContent = '0.00';
    document.getElementById('s2Cr').textContent = '0.00';
    document.getElementById('s2ArStatus').textContent = '0.00';
    document.getElementById('s2ArStatus').style.color = 'var(--text-main)';
    document.getElementById('s2GstStatus').textContent = '0.00 Due (Cash Basis)';
    document.getElementById('badgeAccrualState').textContent = 'Waiting for Invoice';
    document.getElementById('badgeAccrualState').className = 'nzosa-badge amber';
    document.getElementById('badgeCashGstState').textContent = '0.00 Reportable';
    document.getElementById('badgeCashGstState').className = 'nzosa-badge indigo';

    s2RenderTable();
  };

  window.s2Step1_Invoice = function() {
    if (s2Stage >= 1) return;
    s2Stage = 1;
    const b1 = document.getElementById('btnInv1'); b1.className = 'nzosa-btn done'; b1.innerHTML = '✓ 1. Invoice Entered'; b1.disabled = true;
    const b2 = document.getElementById('btnInv2'); b2.className = 'nzosa-btn primary'; b2.disabled = false;

    scale2.spawnOrb({ side: 'left', amount: 225.00, code: '610 AR', label: '225.00', color: '#d97706', isAR: true });
    setTimeout(() => scale2.spawnOrb({ side: 'right', amount: 195.65, code: '200 Sales', label: '195.65', color: '#0d9488' }), 110);
    setTimeout(() => scale2.spawnOrb({ side: 'right', amount: 29.35, code: '820 GST', label: '29.35', color: '#6366f1', gstPending: true }), 220);

    scale2.state.angularVelocity = -0.016;
    scale2.state.targetAngle = 0;

    document.getElementById('s2Dr').textContent = '225.00';
    document.getElementById('s2Cr').textContent = '225.00';
    document.getElementById('s2ArStatus').textContent = '225.00 OWING';
    document.getElementById('s2ArStatus').style.color = 'var(--ar-amber)';
    document.getElementById('s2GstStatus').textContent = '0.00 Due ($29.35 Unpaid)';
    document.getElementById('badgeAccrualState').textContent = '$225.00 Recognised in AR';
    document.getElementById('badgeCashGstState').textContent = '$0.00 Due (Awaiting Cash)';

    s2RenderTable();
  };

  window.s2Step2_BankLands = function() {
    if (s2Stage !== 1) return;
    s2Stage = 2;
    const b2 = document.getElementById('btnInv2'); b2.className = 'nzosa-btn done'; b2.innerHTML = '✓ 2. Bank Line Landed'; b2.disabled = true;
    const b3 = document.getElementById('btnInv3'); b3.className = 'nzosa-btn status-only prompt-tick'; b3.removeAttribute('disabled');

    scale2.spawnOrb({ side: 'left', amount: 225.00, code: 'Bank Dr', label: '225.00', color: '#0284c7' });
    scale2.state.targetAngle = -0.22;

    document.getElementById('s2Dr').textContent = '450.00';
    document.getElementById('s2Cr').textContent = '225.00';
    s2RenderTable();
  };

  window.s2Step3_MatchClear = function() {
    if (s2Stage !== 2) return;
    s2Stage = 3;
    const b3 = document.getElementById('btnInv3'); b3.className = 'nzosa-btn status-only done'; b3.innerHTML = '✓ 3. Matched & AR Cleared';

    scale2.spawnOrb({ side: 'right', amount: 225.00, code: '610 AR Cr', label: '225.00', color: '#d97706', isAR: true });
    scale2.state.targetAngle = 0;

    setTimeout(() => {
      scale2.state.balls.forEach(b => { if (b.isAR) b.cleared = true; if (b.gstPending) b.gstPending = false; });
      document.getElementById('s2Dr').textContent = '450.00';
      document.getElementById('s2Cr').textContent = '450.00';
      document.getElementById('s2ArStatus').textContent = '0.00 CLEARED ✓';
      document.getElementById('s2ArStatus').style.color = 'var(--tick-green)';
      document.getElementById('s2GstStatus').textContent = '29.35 Payable Now ✓';
      document.getElementById('badgeAccrualState').textContent = 'AR Cleared ($0.00)';
      document.getElementById('badgeAccrualState').className = 'nzosa-badge green';
      document.getElementById('badgeCashGstState').textContent = '$29.35 Triggered by Cash ✓';
      document.getElementById('badgeCashGstState').className = 'nzosa-badge green';
      s2RenderTable();
    }, 600);
  };

  function s2RenderTable() {
    const tbody = document.getElementById('s2TableBody');
    const showInv = s2Stage >= 1;
    const showBank = s2Stage >= 2;
    const isCleared = s2Stage >= 3;

    if (s2Stage === 0) {
      document.getElementById('s2SummaryText').innerHTML = `▼ <strong>Invoice Lifecycle:</strong> Ready to post <strong>INV-0049</strong> ($225.00) for Sophie Carter.`;
      document.getElementById('s2HintText').innerHTML = `💡 <strong>Pointer:</strong> Click <strong>1. Enter Invoice (INV-0049)</strong> above to start.`;
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:var(--text-muted);">Click <strong>1. Enter Invoice (INV-0049)</strong> above to post the invoice lines into the ledger.</td></tr>`;
      return;
    }

    if (s2Stage === 1) {
      document.getElementById('s2SummaryText').innerHTML = `▼ <strong>Step 1 (Invoice Entered):</strong> 225.00 Dr to 610 AR | 195.65 Cr Sales + 29.35 Cr GST (Unpaid on Cash Basis).`;
      document.getElementById('s2HintText').innerHTML = `💡 <strong>Pointer:</strong> Now click <strong>2. Bank Payment Lands ($225.00)</strong> when the customer pays.`;
    } else if (s2Stage === 2) {
      document.getElementById('s2SummaryText').innerHTML = `▼ <strong>Step 2 (Bank Payment Landed):</strong> $225.00 received in Bank (450.00 Dr vs 225.00 Cr).`;
      document.getElementById('s2HintText').innerHTML = `💡 <strong>Pointer:</strong> Click the green <strong>✓</strong> tick in the bank row below to match the invoice and clear AR.`;
    } else if (s2Stage === 3) {
      document.getElementById('s2SummaryText').innerHTML = `▼ <strong>Today:</strong> 1 invoice &amp; 1 bank decision matched: <strong>450.00</strong> of debits and <strong>450.00</strong> of credits.`;
      document.getElementById('s2HintText').innerHTML = `🎉 <strong>Complete!</strong> 610 AR is cleared to $0.00, and $29.35 GST is now unlocked for the Cash Basis GST return.`;
    }

    const arStrike = isCleared ? 'nzosa-strike' : '';
    const arBadge1 = isCleared ? '<span class="nzosa-badge green">NET $0.00 ✓</span>' : '<span class="nzosa-badge amber">Accrual Open</span>';
    const arBadge2 = isCleared ? '<span class="nzosa-badge green">CLEARED ✓</span>' : '';
    const gstBadge = isCleared ? '<span class="nzosa-badge green">Cash Received &rarr; Reportable ✓</span>' : '<span class="nzosa-badge indigo">Held Until Cash Paid</span>';
    const bankCrClass = isCleared ? 'nzosa-pending posted' : 'nzosa-pending';
    const tickClass = isCleared ? 'nzosa-tick reconciled' : 'nzosa-tick pulse';

    let html = `
      <tr>
        <td><strong>invoice</strong></td><td>INV-0049</td><td>INV-0049 Sophie Carter</td>
        <td class="center"><span style="color:var(--tick-green); font-weight:bold;">●</span></td>
        <td>610</td><td><i class="nzosa-dot" style="background:var(--ar-amber)"></i>Accounts Receivable ${arBadge1}</td>
        <td>INV-0049 Sophie Carter</td><td class="num ${arStrike}" style="font-weight:600; color:var(--ar-amber)">225.00</td><td class="num"></td>
      </tr>
      <tr>
        <td><strong>invoice</strong></td><td>INV-0049</td><td>INV-0049 Sophie Carter</td><td></td>
        <td>200</td><td><i class="nzosa-dot" style="background:var(--sales-teal)"></i>Sales</td>
        <td>PG2 Flights</td><td class="num"></td><td class="num" style="font-weight:600; color:var(--sales-teal)">195.65</td>
      </tr>
      <tr class="group-end">
        <td><strong>invoice</strong></td><td>INV-0049</td><td>INV-0049 Sophie Carter</td><td></td>
        <td>820</td><td><i class="nzosa-dot" style="background:var(--gst-indigo)"></i>GST ${gstBadge}</td>
        <td>PG2 Flights</td><td class="num"></td><td class="num" style="font-weight:600; color:var(--gst-indigo)">29.35</td>
      </tr>
    `;

    if (showBank) {
      html += `
        <tr>
          <td><strong>bank</strong></td><td>2eef0a2b054d99e6</td><td>MS J SMITH inv 0049</td>
          <td class="center"><button class="${tickClass}" data-learn="s2Step3_MatchClear" title="Match the invoice, ✓ to clear AR">✓</button></td>
          <td>12-3456</td><td><i class="nzosa-dot" style="background:var(--bank-blue)"></i>12-3456-0123456-00</td>
          <td>MS J SMITH inv 0049</td><td class="num" style="font-weight:600; color:var(--bank-blue)">225.00</td><td class="num"></td>
        </tr>
        <tr>
          <td><strong>bank</strong></td><td>2eef0a2b054d99e6</td><td>MS J SMITH inv 0049</td><td></td>
          <td>610</td><td class="${bankCrClass}"><i class="nzosa-dot" style="background:var(--ar-amber)"></i>Accounts Receivable ${arBadge2}</td>
          <td class="${bankCrClass}">INV-0049 Cleared</td><td class="num"></td><td class="num ${bankCrClass} ${arStrike}" style="font-weight:600; color:var(--ar-amber)">225.00</td>
        </tr>
      `;
    }

    tbody.innerHTML = html;
  }

  // Automated Quick Tour preview on page load: automatically ticks the first row after 1.8 seconds to show beginners how it works!
  s1Reset();
  s2Reset();

  setTimeout(() => {
    if (!s1Txs[0].reconciled) {
      s1ReconcileOne(s1Txs[0].id);
    }
  }, 1800);
})();

// The site's security policy allows no inline handlers: every button names its
// action in data-learn (and data-arg), and this one listener answers them.
document.getElementById("nzosa-ledger-showcase").addEventListener("click", function (event) {
  var button = event.target.closest("[data-learn]");
  if (!button || button.disabled) return;
  var action = window[button.dataset.learn];
  if (typeof action !== "function") return;
  var arg = button.dataset.arg;
  if (arg === undefined) action();
  else action(/^-?\d+(\.\d+)?$/.test(arg) ? Number(arg) : arg);
});
