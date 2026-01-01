// server/src/controllers/chat.controller.ts

import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { User } from '../shared/schema';
import { FieldValue } from 'firebase-admin/firestore';

// Helper function to create a unique chat ID
const getChatId = (uid1: string, uid2: string) => {
  return [uid1, uid2].sort().join('_');
};

export const createOrGetChat = async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).send({ error: 'Database not initialized.' });
    }

    const currentUserId = req.user!.uid;
    const { friendId } = req.body;

    if (!friendId) {
      return res.status(400).send({ error: 'Friend ID is required.' });
    }

    const chatId = getChatId(currentUserId, friendId);
    const chatDocRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatDocRef.get();

    if (chatDoc.exists) {
      return res.status(200).json({ id: chatDoc.id, ...chatDoc.data() });
    } else {
      // When a chat is created, it's usually part of the friend request logic,
      // which should initialize the conversation with unreadCount: 0.
      // This function just ensures the central chat document exists.
      const newChatData = {
        participantIds: [currentUserId, friendId],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      await chatDocRef.set(newChatData);
      return res.status(201).json({ id: chatDocRef.id, ...newChatData });
    }
  } catch (error) {
    console.error("Error creating or getting chat:", error);
    res.status(500).send({ error: 'Failed to process chat.' });
  }
};

export const getChatMessages = async (req: Request, res: Response) => {
    try {
        if (!db) {
            return res.status(500).send({ error: 'Database not initialized.' });
        }

        const { chatId } = req.params;
        const messagesSnapshot = await db.collection('chats').doc(chatId).collection('messages').orderBy('createdAt', 'asc').get();
        
        const messages = messagesSnapshot.docs.map(doc => {
            const data = doc.data();
            const ts = data.createdAt;
            let createdAtIso: string;
            if (ts && typeof ts.toDate === 'function') {
                createdAtIso = ts.toDate().toISOString();
            } else if (ts instanceof Date) {
                createdAtIso = ts.toISOString();
            } else if (ts) {
                createdAtIso = new Date(ts).toISOString();
            } else {
                createdAtIso = new Date().toISOString();
            }
            return {
                id: doc.id,
                ...data,
                createdAt: createdAtIso,
            }
        });
        res.status(200).json(messages);
    } catch (error) {
        console.error("Error fetching chat messages:", error);
        res.status(500).send({ error: 'Failed to fetch messages.' });
    }
};


export const sendChatMessage = async (req: Request, res: Response) => {
    try {
        if (!db) {
            return res.status(500).send({ error: 'Database not initialized.' });
        }

        const { chatId } = req.params;
        const senderId = req.user!.uid;
        const { content } = req.body;

        if (!content || typeof content !== 'string' || !content.trim()) {
            return res.status(400).send({ error: 'Message content is required.' });
        }
        if (content.length > 5000) {
            return res.status(400).send({ error: 'Message too long.' });
        }

        const userDoc = await db.collection('users').doc(senderId).get();
        if (!userDoc.exists) {
            return res.status(404).send({ error: 'Sender not found.' });
        }
        const senderProfile = userDoc.data() as User;
        const senderName = `${senderProfile.firstName || ''} ${senderProfile.lastName || ''}`.trim() || senderProfile.username;

        const messageData = {
            content,
            senderId,
            senderName,
            createdAt: FieldValue.serverTimestamp(),
        };

        const messageRef = db.collection('chats').doc(chatId).collection('messages').doc();
        const batch = db.batch();

        batch.set(messageRef, messageData);

        const chatDoc = await db.collection('chats').doc(chatId).get();
        const participantIds = chatDoc.data()?.participantIds;
        if (participantIds && participantIds.length === 2) {
            const receiverId = participantIds.find((id: string) => id !== senderId)!;
            const receiverDoc = await db.collection('users').doc(receiverId).get();
            const receiverProfile = receiverDoc.data() as User;

            // Update my (the sender's) conversation list
            const myConvRef = db.collection('users').doc(senderId).collection('conversations').doc(receiverId);
            batch.set(myConvRef, { 
                name: `${receiverProfile.firstName || ''} ${receiverProfile.lastName || ''}`.trim() || receiverProfile.username,
                profileImageUrl: receiverProfile.profileImageUrl || '',
                type: 'dm',
                lastMessage: `You: ${content}`, 
                timestamp: FieldValue.serverTimestamp() 
            }, { merge: true });

            // Update their (the receiver's) conversation list
            const theirConvRef = db.collection('users').doc(receiverId).collection('conversations').doc(senderId);
            batch.set(theirConvRef, {
                name: senderName, // Humne yeh pehle hi get kar liya tha
                profileImageUrl: senderProfile.profileImageUrl || '',
                type: 'dm',
                lastMessage: content,
                timestamp: FieldValue.serverTimestamp(),
                unreadCount: FieldValue.increment(1) 
            }, { merge: true });
        }

        await batch.commit();

        res.status(201).json({ 
            id: messageRef.id, 
            ...messageData,
            createdAt: new Date().toISOString() 
        });
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).send({ error: 'Failed to send message.' });
    }
};

// Add this new function to the end of the file
export const logCallEvent = async (req: Request, res: Response) => {
    try {
        if (!db) {
            return res.status(500).send({ error: 'Database not initialized.' });
        }

        const { chatId } = req.params; // Use chatId for one-on-one chats
        const { callerName, type, duration } = req.body;

        // Create the special "call log" message
        const messageData = {
            senderId: 'system', // Special ID for system messages
            senderName: callerName,
            createdAt: FieldValue.serverTimestamp(),
            type: 'call-log', // Special type for our message bubble
            callInfo: { type, duration } // Data about the call
        };

        // Add the new message to the chats messages subcollection
        await db.collection('chats').doc(chatId).collection('messages').add(messageData);

        res.status(201).send({ message: "Call event logged." });
    } catch (error) {
        console.error("Error logging call event:", error);
        res.status(500).send({ error: "Failed to log call event." });
    }
};