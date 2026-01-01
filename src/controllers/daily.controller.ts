// server/src/controllers/daily.controller.ts

import { Request, Response } from 'express';
import { db } from '../config/firebase.js';
import fetch from 'node-fetch';

const DAILY_API_KEY = process.env.DAILY_API_KEY;
const DAILY_API_BASE_URL = 'https://api.daily.co/v1';

/**
 * Get or create a Daily.co room for a group
 * POST /api/groups/:groupId/call
 */
export const getOrCreateDailyRoom = async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).send({ error: 'Database not initialized.' });
    }

    const { groupId } = req.params;
    const userId = req.user!.uid;

    // Verify DAILY_API_KEY is configured
    if (!DAILY_API_KEY) {
      console.error('❌ DAILY_API_KEY is not configured in environment variables');
      return res.status(500).json({ 
        error: 'Daily.co API is not configured. Please contact the administrator.' 
      });
    }

    // Verify user is a member of the group
    const memberDoc = await db
      .collection('groups')
      .doc(groupId)
      .collection('members')
      .doc(userId)
      .get();

    if (!memberDoc.exists) {
      return res.status(403).json({ 
        error: 'You must be a member of this group to join calls.' 
      });
    }

    // Get the group document
    const groupDoc = await db.collection('groups').doc(groupId).get();
    
    if (!groupDoc.exists) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const groupData = groupDoc.data();

    // Check if a Daily room URL already exists
    if (groupData?.dailyRoomUrl) {
      console.log(`✅ Returning existing Daily room for group ${groupId}`);
      return res.status(200).json({ 
        roomUrl: groupData.dailyRoomUrl,
        isNewRoom: false
      });
    }

    // Create a new Daily.co room
    console.log(`🔨 Creating new Daily room for group ${groupId}`);
    
    const roomName = `studyhive-${groupId}`;
    
    const response = await fetch(`${DAILY_API_BASE_URL}/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DAILY_API_KEY}`
      },
      body: JSON.stringify({
        name: roomName,
        privacy: 'private', // Only people with the link can join
        properties: {
          enable_screenshare: true,
          enable_chat: true,
          enable_knocking: false, // No waiting room
          start_video_off: false,
          start_audio_off: false,
          max_participants: 50 // Adjust as needed
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ Daily.co API error:', response.status, errorData);
      
      // Handle specific error cases
      if (response.status === 401) {
        return res.status(500).json({ 
          error: 'Daily.co authentication failed. Please contact the administrator.' 
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to create video call room. Please try again later.' 
      });
    }

    const roomData = await response.json() as { url: string };
    const dailyRoomUrl = roomData.url;

    // Save the room URL to the group document
    await db.collection('groups').doc(groupId).update({
      dailyRoomUrl: dailyRoomUrl
    });

    console.log(`✅ Created and saved Daily room: ${dailyRoomUrl}`);

    return res.status(200).json({ 
      roomUrl: dailyRoomUrl,
      isNewRoom: true
    });

  } catch (error) {
    console.error('❌ Error in getOrCreateDailyRoom:', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred while setting up the call.' 
    });
  }
};

