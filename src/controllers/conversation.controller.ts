// server/src/controllers/conversation.controller.ts

import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { FieldValue } from 'firebase-admin/firestore'; // --- NEW: Import FieldValue ---

export const getConversations = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.uid;

    const conversationsRef = db.collection('users').doc(userId).collection('conversations');
    const snapshot = await conversationsRef.get();

    // Convert conversations to array and format timestamps
    const conversations = snapshot.docs.map(doc => {
      const data = doc.data();
      let timestamp;

      // Handle various timestamp formats
      if (data.timestamp && typeof data.timestamp.toDate === 'function') {
        timestamp = data.timestamp.toDate().toISOString();
      } else if (data.timestamp instanceof Date) {
        timestamp = data.timestamp.toISOString();
      } else if (data.timestamp) {
        timestamp = new Date(data.timestamp).toISOString();
      } else {
        // If no timestamp, use current time
        timestamp = new Date().toISOString();
      }

      return {
        id: doc.id,
        ...data,
        timestamp: timestamp,
      };
    });

    // Sort on the backend by timestamp (newest first)
    conversations.sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    res.status(200).json(conversations);

  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).send({ error: 'Failed to fetch conversations.' });
  }
};

// --- NEW: Function to mark a conversation as read ---
export const markAsRead = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user!.uid;

    const convRef = db.collection('users').doc(userId).collection('conversations').doc(conversationId);
    
    // Set the unread count to 0
    await convRef.update({
      unreadCount: 0
    });

    res.status(200).send({ message: 'Conversation marked as read.' });
  } catch (error) {
    // It's okay if this fails sometimes (e.g., document doesn't exist yet), so don't log as a major error
    // console.error('Could not mark conversation as read:', error);
    res.status(200).send({ message: 'Acknowledged.' }); // Send success to not block client
  }
};

// --- NEW: One-time sync to fix missing conversation entries ---
export const syncConversations = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.uid;

    // Get user's groupIds
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const userGroupIds = userData?.groupIds || [];

    if (userGroupIds.length === 0) {
      return res.status(200).json({ message: 'No groups to sync', synced: 0 });
    }

    const conversationsRef = db.collection('users').doc(userId).collection('conversations');
    const snapshot = await conversationsRef.get();

    // Create a set of existing conversation IDs
    const existingConvIds = new Set(snapshot.docs.map(doc => doc.id));

    // Find missing groups
    const missingGroupIds = userGroupIds.filter((gId: string) => !existingConvIds.has(gId));

    if (missingGroupIds.length === 0) {
      return res.status(200).json({ message: 'All conversations already synced', synced: 0 });
    }

    // Create missing conversation entries
    const batch = db.batch();
    let syncedCount = 0;

    for (const groupId of missingGroupIds) {
      const groupDoc = await db.collection('groups').doc(groupId).get();
      if (groupDoc.exists) {
        const groupData = groupDoc.data();
        const conversationRef = conversationsRef.doc(groupId);
        
        batch.set(conversationRef, {
          name: groupData?.name || 'Study Group',
          profileImageUrl: groupData?.coverImage || '',
          type: 'group',
          timestamp: FieldValue.serverTimestamp(),
          lastMessage: 'You are a member of this group',
          unreadCount: 0
        });
        
        syncedCount++;
      }
    }

    if (syncedCount > 0) {
      await batch.commit();
    }

    res.status(200).json({ 
      message: `Successfully synced ${syncedCount} conversation(s)`, 
      synced: syncedCount 
    });

  } catch (error) {
    console.error("Error syncing conversations:", error);
    res.status(500).send({ error: 'Failed to sync conversations.' });
  }
};
