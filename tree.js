// ============================================================
// tree.js - แสดงแผนผังครอบครัวจาก familyRawData (flat array)
// รองรับ: การแต่งงานหลายครั้ง, หย่า, บุตรจากคนละคู่สมรส
// ============================================================

const CONFIG = {
    nodeWidth: 160,
    nodeHeight: 155,
    horizontalGap: 70,
    verticalGap: 100,
    spouseGap: 60
};

let state = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    isDragging: false,
    lastX: 0,
    lastY: 0,
    selectedPersonId: null
};

let peopleMap = {};
let unions = [];
let unionsByPerson = {};
let renderedNodes = new Map();
let renderedUnions = new Map();
let lastLayout = null;

document.addEventListener('DOMContentLoaded', () => {
    convertAndBuildIndexes();
    initEvents();
    renderTree();
    centerTree();
});

// แปลงข้อมูล flat array เป็นรูปแบบ people + unions
function convertAndBuildIndexes() {
    peopleMap = {};
    (typeof familyRawData !== 'undefined' ? familyRawData : []).forEach(p => {
        peopleMap[p.id] = {
            id: p.id,
            firstName: p.name,
            lastName: '',
            gender: p.gender === 'ช' ? 'male' : 'female',
            father: p.father || '',
            mother: p.mother || '',
            photo: p.photo || null,
            birthDate: null,
            deathDate: null,
            bio: ''
        };
    });

    unions = [];
    const unionKeys = new Set();

    (typeof familyRawData !== 'undefined' ? familyRawData : []).forEach(p => {
        (p.spouse || []).forEach(sid => {
            if (!peopleMap[sid]) return;
            const key = [p.id, sid].sort().join('-');
            if (unionKeys.has(key)) return;

            const children = (typeof familyRawData !== 'undefined' ? familyRawData : []).filter(c => {
                return (c.father === p.id && c.mother === sid) ||
                       (c.father === sid && c.mother === p.id);
            }).map(c => c.id);

            unions.push({
                id: 'u' + (unions.length + 1),
                partners: [p.id, sid],
                children: children,
                type: 'marriage',
                startDate: null,
                endDate: null
            });
            unionKeys.add(key);
        });
    });

    unionsByPerson = {};
    unions.forEach(u => {
        u.partners.forEach(pid => {
            if (!unionsByPerson[pid]) unionsByPerson[pid] = [];
            unionsByPerson[pid].push(u);
        });
    });
}

function initEvents() {
    const main = document.getElementById('main-area');

    main.addEventListener('mousedown', e => {
        if (e.target.closest('.node') || e.target.closest('.union-node')) return;
        state.isDragging = true;
        state.lastX = e.clientX;
        state.lastY = e.clientY;
    });

    window.addEventListener('mousemove', e => {
        if (!state.isDragging) return;
        const dx = e.clientX - state.lastX;
        const dy = e.clientY - state.lastY;
        state.translateX += dx;
        state.translateY += dy;
        state.lastX = e.clientX;
        state.lastY = e.clientY;
        updateTransform();
    });

    window.addEventListener('mouseup', () => {
        state.isDragging = false;
    });

    main.addEventListener('wheel', e => {
        e.preventDefault();
        const zoomIntensity = 0.001;
        const delta = -e.deltaY * zoomIntensity;
        const newScale = Math.min(Math.max(state.scale + delta, 0.3), 2.5);
        state.scale = newScale;
        updateTransform();
    }, { passive: false });

    document.getElementById('zoom-in').addEventListener('click', () => {
        state.scale = Math.min(state.scale + 0.2, 2.5);
        updateTransform();
    });
    document.getElementById('zoom-out').addEventListener('click', () => {
        state.scale = Math.max(state.scale - 0.2, 0.3);
        updateTransform();
    });
    document.getElementById('zoom-fit').addEventListener('click', centerTree);
    document.getElementById('btn-reset').addEventListener('click', centerTree);

    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        searchResults.innerHTML = '';
        if (query.length < 1) {
            searchResults.classList.remove('active');
            return;
        }

        const matches = Object.values(peopleMap).filter(p => {
            return p.firstName.toLowerCase().includes(query);
        });

        matches.forEach(p => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.textContent = p.firstName;
            div.addEventListener('click', () => {
                focusOnPerson(p.id);
                searchResults.classList.remove('active');
                searchInput.value = '';
            });
            searchResults.appendChild(div);
        });

        searchResults.classList.toggle('active', matches.length > 0);
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.search-box')) {
            searchResults.classList.remove('active');
        }
    });
}

function updateTransform() {
    const canvas = document.getElementById('tree-canvas');
    canvas.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
}

function calcUnionWidth(union) {
    const partnersW = union.partners.length * CONFIG.nodeWidth + (union.partners.length - 1) * CONFIG.spouseGap;
    if (union.children.length === 0) return partnersW;

    let childrenW = 0;
    union.children.forEach((cid, idx) => {
        childrenW += calcPersonWidth(cid);
        if (idx < union.children.length - 1) childrenW += CONFIG.horizontalGap;
    });

    return Math.max(partnersW, childrenW);
}

function calcPersonWidth(pid) {
    const personUnions = unionsByPerson[pid] || [];
    if (personUnions.length === 0) return CONFIG.nodeWidth;

    let total = 0;
    personUnions.forEach((u, idx) => {
        total += calcUnionWidth(u);
        if (idx < personUnions.length - 1) total += CONFIG.horizontalGap;
    });
    return total;
}

function computeLayout() {
    const personNodes = [];
    const unionNodes = [];
    const connections = [];
    let keyCounter = 0;

    function addPersonNode(personId, x, y, unionId) {
        personNodes.push({
            id: personId,
            x: x,
            y: y,
            unionId: unionId,
            key: personId + '-' + (unionId || 'single') + '-' + (keyCounter++)
        });
    }

    function addUnionNode(unionId, x, y) {
        unionNodes.push({ id: unionId, x: x, y: y });
    }

    function addConnection(x1, y1, x2, y2) {
        connections.push({ x1, y1, x2, y2 });
    }

    function placeUnion(union, centerX, y) {
        const partnersW = union.partners.length * CONFIG.nodeWidth + (union.partners.length - 1) * CONFIG.spouseGap;
        const startX = centerX - partnersW / 2;
        const marriageY = y + CONFIG.nodeHeight / 2;
        const partnerXs = [];

        union.partners.forEach((pid, idx) => {
            const px = startX + idx * (CONFIG.nodeWidth + CONFIG.spouseGap) + CONFIG.nodeWidth / 2;
            partnerXs.push(px);
            addPersonNode(pid, px, y, union.id);
        });

        const minPx = Math.min(...partnerXs);
        const maxPx = Math.max(...partnerXs);
        addConnection(minPx, marriageY, maxPx, marriageY);

        const ux = centerX;
        const uy = marriageY + 22;
        addUnionNode(union.id, ux, uy);
        addConnection((minPx + maxPx) / 2, marriageY, ux, uy);

        if (union.children.length === 0) return;

        const childY = uy + CONFIG.verticalGap;
        const childTopY = childY - CONFIG.nodeHeight / 2;
        const midY = (uy + childTopY) / 2;

        let childrenTotalW = 0;
        union.children.forEach((cid, idx) => {
            childrenTotalW += calcPersonWidth(cid);
            if (idx < union.children.length - 1) childrenTotalW += CONFIG.horizontalGap;
        });

        let childX = centerX - childrenTotalW / 2;
        const childConnectionXs = [];

        union.children.forEach(cid => {
            const childW = calcPersonWidth(cid);
            const childCenterX = childX + childW / 2;

            if (unionsByPerson[cid] && unionsByPerson[cid].length > 0) {
                const childUnions = unionsByPerson[cid];
                let uTotal = 0;
                childUnions.forEach((u, idx) => {
                    uTotal += calcUnionWidth(u);
                    if (idx < childUnions.length - 1) uTotal += CONFIG.horizontalGap;
                });

                let uStartX = childCenterX - uTotal / 2;
                childUnions.forEach(u => {
                    const uw = calcUnionWidth(u);
                    const uCenterX = uStartX + uw / 2;
                    placeUnion(u, uCenterX, childY);
                    childConnectionXs.push({ x: uCenterX, isUnion: true, childY: childY });
                    uStartX += uw + CONFIG.horizontalGap;
                });
            } else {
                addPersonNode(cid, childCenterX, childY, null);
                childConnectionXs.push({ x: childCenterX, isUnion: false, childY: childY });
            }

            childX += childW + CONFIG.horizontalGap;
        });

        addConnection(ux, uy, ux, midY);
        if (childConnectionXs.length > 1) {
            addConnection(
                Math.min(...childConnectionXs.map(c => c.x)),
                midY,
                Math.max(...childConnectionXs.map(c => c.x)),
                midY
            );
        }

        childConnectionXs.forEach(c => {
            if (c.isUnion) {
                const uNodeY = c.childY + CONFIG.nodeHeight / 2 + 22;
                addConnection(c.x, midY, c.x, uNodeY);
            } else {
                addConnection(c.x, midY, c.x, c.childY - CONFIG.nodeHeight / 2);
            }
        });
    }

    // หา union ต้นกำเนิด (ไม่มีพ่อแม่ในข้อมูล)
    const birthUnionIds = {};
    unions.forEach(u => {
        u.children.forEach(cid => birthUnionIds[cid] = u.id);
    });

    const rootUnions = unions.filter(u => {
        return !u.partners.some(pid => birthUnionIds[pid]);
    });

    const rootSinglePeople = Object.values(peopleMap).filter(p => {
        return !p.father && !p.mother && (!unionsByPerson[p.id] || unionsByPerson[p.id].length === 0);
    });

    let totalW = rootUnions.reduce((sum, u, idx) => {
        sum += calcUnionWidth(u);
        if (idx < rootUnions.length - 1) sum += CONFIG.horizontalGap * 2;
        return sum;
    }, 0);

    rootSinglePeople.forEach((p, idx) => {
        totalW += CONFIG.nodeWidth;
        if (idx > 0 || rootUnions.length > 0) totalW += CONFIG.horizontalGap * 2;
    });

    let startX = -totalW / 2;

    rootUnions.forEach(u => {
        const uw = calcUnionWidth(u);
        placeUnion(u, startX + uw / 2, 80);
        startX += uw + CONFIG.horizontalGap * 2;
    });

    rootSinglePeople.forEach((p, idx) => {
        addPersonNode(p.id, startX + CONFIG.nodeWidth / 2, 80, null);
        startX += CONFIG.nodeWidth + CONFIG.horizontalGap * 2;
    });

    return { personNodes, unionNodes, connections };
}

function renderTree() {
    const container = document.getElementById('nodes-container');
    const svg = document.getElementById('connections');
    container.innerHTML = '';
    svg.innerHTML = '';

    const layout = computeLayout();
    lastLayout = layout;
    renderedNodes.clear();
    renderedUnions.clear();

    drawConnections(layout.connections, svg);

    layout.unionNodes.forEach(uNode => {
        const union = unions.find(u => u.id === uNode.id);
        const el = document.createElement('div');
        el.className = 'union-node';
        el.style.left = uNode.x + 'px';
        el.style.top = uNode.y + 'px';
        el.textContent = union && union.type === 'divorce' ? '✕' : '♥';
        container.appendChild(el);
        renderedUnions.set(uNode.id, { el, x: uNode.x, y: uNode.y });
    });

    layout.personNodes.forEach(pNode => {
        const person = peopleMap[pNode.id];
        if (!person) return;

        const el = createPersonNode(person);
        el.style.left = (pNode.x - CONFIG.nodeWidth / 2) + 'px';
        el.style.top = (pNode.y - CONFIG.nodeHeight / 2) + 'px';
        el.dataset.personId = pNode.id;

        el.addEventListener('click', e => {
            e.stopPropagation();
            selectPerson(pNode.id);
        });

        container.appendChild(el);

        if (!renderedNodes.has(pNode.id)) {
            renderedNodes.set(pNode.id, { el, x: pNode.x, y: pNode.y });
        }
    });
}

function drawConnections(connections, svg) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    connections.forEach(c => {
        minX = Math.min(minX, c.x1, c.x2);
        minY = Math.min(minY, c.y1, c.y2);
        maxX = Math.max(maxX, c.x1, c.x2);
        maxY = Math.max(maxY, c.y1, c.y2);
    });

    if (minX === Infinity) {
        minX = 0; minY = 0; maxX = 800; maxY = 600;
    }

    const padding = 50;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;

    svg.setAttribute('viewBox', `${minX - padding} ${minY - padding} ${width} ${height}`);
    svg.style.width = width + 'px';
    svg.style.height = height + 'px';
    svg.style.left = (minX - padding) + 'px';
    svg.style.top = (minY - padding) + 'px';

    connections.forEach(c => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${c.x1} ${c.y1} L ${c.x2} ${c.y2}`);
        path.setAttribute('class', 'connection-line');
        svg.appendChild(path);
    });
}

function createPersonNode(person) {
    const div = document.createElement('div');
    div.className = 'node';

    const unions = unionsByPerson[person.id] || [];
    const spouseCount = unions.length;

    div.innerHTML = `
        <div class="node-avatar ${person.gender}">
            ${person.photo ? `<img src="${person.photo}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : getInitials(person)}
        </div>
        <div class="node-name">${person.firstName}</div>
        <div class="node-badges">
            <span class="badge">${person.gender === 'male' ? 'ชาย' : 'หญิง'}</span>
            ${spouseCount > 1 ? `<span class="badge spouse-count">สมรส ${spouseCount} ครั้ง</span>` : ''}
        </div>
    `;

    return div;
}

function selectPerson(personId) {
    state.selectedPersonId = personId;

    document.querySelectorAll('.node').forEach(n => n.classList.remove('highlighted'));
    document.querySelectorAll(`.node[data-person-id="${personId}"]`).forEach(n => {
        n.classList.add('highlighted');
    });

    renderSidePanel(personId);
}

function renderSidePanel(personId) {
    const person = peopleMap[personId];
    const panel = document.getElementById('side-panel');
    const unions = unionsByPerson[personId] || [];
    const parents = findParents(personId);

    let html = `
        <div class="panel-avatar ${person.gender}">
            ${person.photo ? `<img src="${person.photo}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : getInitials(person)}
        </div>
        <div class="panel-name">${person.firstName}</div>
        <div class="panel-subtitle">${person.gender === 'male' ? 'เพศชาย' : 'เพศหญิง'}</div>
    `;

    if (parents.length > 0) {
        html += `
            <div class="panel-section">
                <div class="panel-section-title">บิดา-มารดา</div>
                ${parents.map(p => `
                    <div class="union-card" onclick="focusOnPerson('${p.id}')" style="cursor:pointer;">
                        <div class="union-partner">${p.firstName}</div>
                        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${p.gender === 'male' ? 'บิดา' : 'มารดา'}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    if (unions.length > 0) {
        html += `
            <div class="panel-section">
                <div class="panel-section-title">คู่สมรส (${unions.length} คน)</div>
                ${unions.map((u, idx) => {
                    const partners = u.partners.filter(id => id !== personId).map(id => peopleMap[id]).filter(Boolean);
                    const partnerNames = partners.length > 0 ? partners.map(p => p.firstName).join(', ') : 'ไม่ระบุ';
                    const status = u.endDate ? 'หย่า/แยกทาง' : 'อยู่ด้วยกัน';
                    const typeLabel = u.type === 'marriage' ? 'สมรส' : (u.type === 'partnership' ? 'คู่ชีวิต' : 'หย่า');

                    return `
                        <div class="union-card">
                            <div class="union-header">
                                <span class="union-type">${typeLabel} ครั้งที่ ${idx + 1}</span>
                                <span style="font-size:12px;color:var(--text-muted);">${status}</span>
                            </div>
                            <div class="union-partner">กับ ${partnerNames}</div>
                            ${u.children.length > 0 ? `
                                <div style="font-size:12px;color:var(--accent-light);margin-top:10px;margin-bottom:6px;">บุตร (${u.children.length} คน)</div>
                                <div class="union-children">
                                    ${u.children.map(cid => {
                                        const c = peopleMap[cid];
                                        return `<span class="child-chip" onclick="focusOnPerson('${cid}')">${c.firstName}</span>`;
                                    }).join('')}
                                </div>
                            ` : '<div style="font-size:12px;color:var(--text-muted);margin-top:8px;">ไม่มีบุตร</div>'}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    if (person.bio) {
        html += `
            <div class="panel-section">
                <div class="panel-section-title">ประวัติย่อ</div>
                <p style="font-size:14px;line-height:1.7;color:var(--text-muted);">${person.bio}</p>
            </div>
        `;
    }

    panel.innerHTML = html;
}

function focusOnPerson(personId) {
    if (!lastLayout) return;

    const firstNode = lastLayout.personNodes.find(n => n.id === personId);
    if (!firstNode) return;

    const main = document.getElementById('main-area');
    const mainRect = main.getBoundingClientRect();
    const centerX = mainRect.width / 2;
    const centerY = mainRect.height / 2;

    state.scale = 1;
    state.translateX = centerX - firstNode.x;
    state.translateY = centerY - firstNode.y;
    updateTransform();
    selectPerson(personId);
}

function centerTree() {
    const main = document.getElementById('main-area');
    const mainRect = main.getBoundingClientRect();

    state.scale = 0.8;
    state.translateX = mainRect.width / 2;
    state.translateY = 60;
    updateTransform();
}

function findParents(personId) {
    const parents = [];
    unions.forEach(u => {
        if (u.children.includes(personId)) {
            u.partners.forEach(pid => {
                if (peopleMap[pid]) parents.push(peopleMap[pid]);
            });
        }
    });
    return parents;
}

function getInitials(person) {
    return person.firstName ? person.firstName[0] : '?';
}
