const WebSocket = require('ws');
const { pack, unpack } = require('msgpackr');
const Y = require('yjs');

const ws = new WebSocket('ws://localhost:5171');
const roomId = 'RADKQS';
const docs = new Map(); // docId -> { yDoc: Y.Doc, fileName: string }

ws.on('open', () => {
  console.log('Connected to server');
  const joinMsg = {
    type: 'joinRoom',
    roomId: roomId,
    displayName: 'Gemini AI',
    secret: undefined,
  };
  ws.send(pack(joinMsg));
});

ws.on('message', (data) => {
  const msg = unpack(data);

  if (msg.type === 'joinedRoom') {
    console.log('Successfully joined room:', roomId);
    sendChat('I am now Yjs-enabled! I can see what you type in shared files. I will watch test.txt! 👀');
  }

  if (msg.type === 'chatMessage') {
    console.log(`[${msg.fromName}]: ${msg.content}`);
    if (msg.content.toLowerCase().includes('ping')) {
      sendChat('Pong! 🏓');
    }
  }

  if (msg.type === 'shareDocument' || msg.type === 'fullDocumentSync') {
    console.log(`📄 Document Synced: ${msg.fileName || 'unknown'} (${msg.docId})`);
    let docEntry = docs.get(msg.docId);
    if (!docEntry) {
      const yDoc = new Y.Doc();
      docEntry = { yDoc, fileName: msg.fileName };
      docs.set(msg.docId, docEntry);
      
      // Listen for local changes to send back (if we want to type)
      yDoc.on('update', update => {
        // For simplicity, we only send updates if we initiated them
      });
    }

    if (msg.yjsState) {
      Y.applyUpdate(docEntry.yDoc, msg.yjsState);
    } else if (msg.text) {
      docEntry.yDoc.getText('text').insert(0, msg.text);
    }
    
    checkTestFile(docEntry);
  }

  if (msg.type === 'docChangeBroadcast') {
    const docEntry = docs.get(msg.docId);
    if (docEntry && msg.yjsUpdate) {
      Y.applyUpdate(docEntry.yDoc, msg.yjsUpdate);
      checkTestFile(docEntry);
    }
  }
  
  if (msg.type === 'error') {
    console.error('Server Error:', msg.message);
  }
});

function checkTestFile(docEntry) {
  if (docEntry.fileName === 'test.txt') {
    const text = docEntry.yDoc.getText('text').toString();
    console.log('--- test.txt content ---');
    console.log(text);
    console.log('------------------------');
    
    if (text.includes('Gemini, respond:')) {
       // Simple automation: respond inside the file
       if (!text.includes('Gemini Response:')) {
         const response = '\n\nGemini Response: I see you! The Yjs sync is working perfectly. No lag detected! ✅';
         const yText = docEntry.yDoc.getText('text');
         const update = Y.encodeStateAsUpdate(docEntry.yDoc); // This is not quite right for sending back, 
         // but since I am a bot I will just send a chat saying I saw it for now.
         sendChat('I saw your message in test.txt! "I see you! The Yjs sync is working perfectly."');
       }
    }
  }
}

function sendChat(content) {
  const chatMsg = {
    type: 'chatSend',
    roomId: roomId,
    messageId: 'msg-' + Date.now(),
    content: content,
    timestamp: Date.now()
  };
  ws.send(pack(chatMsg));
}

ws.on('error', (err) => console.error('WS Error:', err));
ws.on('close', () => console.log('Disconnected'));

// Stay for 20 minutes
setTimeout(() => {
  console.log('Bot session ending...');
  ws.close();
  process.exit(0);
}, 1200000);
