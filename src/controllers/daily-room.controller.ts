// server/src/controllers/daily-room.controller.ts
/**
 * Daily Room Controller
 * 
 * Handles creation and retrieval of Daily.co rooms for audio/video calls.
 */

import { Request, Response } from 'express';
import { db } from '../config/firebase';
import fetch from 'node-fetch';

const DAILY_API_BASE_URL = 'https://api.daily.co/v1';

// Helper function to get DAILY_API_KEY
const getDailyApiKey = (): string | undefined => {
  const key = process.env.DAILY_API_KEY;
  if (!key) {
    console.error('❌ DAILY_API_KEY is not configured in environment variables');
    return undefined;
  }
  return key;
};

/**
 * Create or get Daily room for a group call
 * POST /api/groups/:groupId/daily-room
 */
export const createOrGetGroupDailyRoom = async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).send({ error: 'Database not initialized.' });
    }

    const { groupId } = req.params;
    const userId = req.user!.uid;

    // Verify DAILY_API_KEY is configured
    const DAILY_API_KEY = getDailyApiKey();
    if (!DAILY_API_KEY) {
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
        error: 'You must be a member of this group to create or join calls.' 
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
      const existingRoomUrl = groupData.dailyRoomUrl;
      
      // Verify the room still exists and is accessible
      try {
        const roomName = existingRoomUrl.split('/').pop() || `studyhive-${groupId}`;
        const checkResponse = await fetch(`${DAILY_API_BASE_URL}/rooms/${roomName}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${DAILY_API_KEY}`
          }
        });

        if (checkResponse.ok) {
          // Generate a token for joining the existing room
          const roomName = existingRoomUrl.split('/').pop() || `studyhive-${groupId}`;
          const tokenResponse = await fetch(`${DAILY_API_BASE_URL}/meeting-tokens`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${DAILY_API_KEY}`
            },
            body: JSON.stringify({
              properties: {
                room_name: roomName,
                is_owner: false, // Participant is not owner
                exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // Token expires in 24 hours
              }
            })
          });

          let token: string | undefined;
          if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json() as { token: string };
            token = tokenData.token;
            console.log('✅ Generated Daily.co token for existing room');
          }

          console.log(`✅ Returning existing Daily room for group ${groupId}`);
          return res.status(200).json({ 
            roomUrl: existingRoomUrl,
            token: token, // Include token in response
            isNewRoom: false
          });
        }
      } catch (error) {
        console.error('Error checking existing room:', error);
        // Continue to create a new room
      }
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
        privacy: 'public', // Public room - access controlled by backend membership check
        properties: {
          enable_screenshare: true,
          enable_chat: true,
          enable_knocking: false, // No waiting room
          start_video_off: false,
          start_audio_off: false,
          max_participants: 50
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ Daily.co API error:', response.status, errorData);
      
      if (response.status === 401) {
        return res.status(500).json({ 
          error: 'Daily.co authentication failed. Please contact the administrator.' 
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to create video call room. Please try again later.' 
      });
    }

    const roomData = await response.json() as { url: string; name: string };
    const dailyRoomUrl = roomData.url;
    // Use room name from response (more accurate than the one we sent)
    const actualRoomName = roomData.name;

    // Generate a token for the user to join the room
    // Tokens are required for Daily.co rooms to ensure secure access
    const tokenResponse = await fetch(`${DAILY_API_BASE_URL}/meeting-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DAILY_API_KEY}`
      },
      body: JSON.stringify({
        properties: {
          room_name: actualRoomName,
          is_owner: true, // First user (host) is owner
          exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // Token expires in 24 hours
        }
      })
    });

    let token: string | undefined;
    if (tokenResponse.ok) {
      const tokenData = await tokenResponse.json() as { token: string };
      token = tokenData.token;
      console.log('✅ Generated Daily.co token for room');
    } else {
      console.warn('⚠️ Could not generate token, room may still work without it');
    }

    // Save the room URL to the group document
    await db.collection('groups').doc(groupId).update({
      dailyRoomUrl: dailyRoomUrl
    });

    console.log(`✅ Created and saved Daily room: ${dailyRoomUrl}`);

    return res.status(200).json({ 
      roomUrl: dailyRoomUrl,
      token: token, // Include token in response
      isNewRoom: true
    });

  } catch (error) {
    console.error('❌ Error in createOrGetGroupDailyRoom:', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred while setting up the call.' 
    });
  }
};

/**
 * Create or get Daily room for a study session call
 * POST /api/sessions/:sessionId/daily-room
 */
export const createOrGetSessionDailyRoom = async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).send({ error: 'Database not initialized.' });
    }

    const { sessionId } = req.params;
    const userId = req.user!.uid;

    // Verify DAILY_API_KEY is configured
    const DAILY_API_KEY = getDailyApiKey();
    if (!DAILY_API_KEY) {
      return res.status(500).json({ 
        error: 'Daily.co API is not configured. Please contact the administrator.' 
      });
    }

    // Get the session document
    const sessionDoc = await db.collection('sessions').doc(sessionId).get();
    
    if (!sessionDoc.exists) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const sessionData = sessionDoc.data();
    const groupId = sessionData?.groupId;

    if (!groupId) {
      return res.status(400).json({ error: 'Session is missing groupId.' });
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
        error: 'You must be a member of this group to join the session.' 
      });
    }

    // Check if a Daily room URL already exists in the session
    if (sessionData?.dailyRoomUrl) {
      const existingRoomUrl = sessionData.dailyRoomUrl;
      
      // Verify the room still exists and is accessible
      try {
        const roomName = existingRoomUrl.split('/').pop() || `studyhive-session-${sessionId}`;
        const checkResponse = await fetch(`${DAILY_API_BASE_URL}/rooms/${roomName}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${DAILY_API_KEY}`
          }
        });

        if (checkResponse.ok) {
          // Generate a token for joining the existing room
          const roomName = existingRoomUrl.split('/').pop() || `studyhive-session-${sessionId}`;
          const tokenResponse = await fetch(`${DAILY_API_BASE_URL}/meeting-tokens`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${DAILY_API_KEY}`
            },
            body: JSON.stringify({
              properties: {
                room_name: roomName,
                is_owner: false, // Participant is not owner
                exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // Token expires in 24 hours
              }
            })
          });

          let token: string | undefined;
          if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json() as { token: string };
            token = tokenData.token;
            console.log('✅ Generated Daily.co token for existing session room');
          }

          console.log(`✅ Returning existing Daily room for session ${sessionId}`);
          return res.status(200).json({ 
            roomUrl: existingRoomUrl,
            token: token, // Include token in response
            isNewRoom: false
          });
        }
      } catch (error) {
        console.error('Error checking existing session room:', error);
        // Continue to create a new room
      }
    }

    // Create a new Daily.co room
    console.log(`🔨 Creating new Daily room for session ${sessionId}`);
    
    const roomName = `studyhive-session-${sessionId}`;
    
    const response = await fetch(`${DAILY_API_BASE_URL}/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DAILY_API_KEY}`
      },
      body: JSON.stringify({
        name: roomName,
        privacy: 'public', // Public room - access controlled by backend membership check
        properties: {
          enable_screenshare: true,
          enable_chat: true,
          enable_knocking: false, // No waiting room
          start_video_off: false,
          start_audio_off: false,
          max_participants: 50
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ Daily.co API error:', response.status, errorData);
      
      if (response.status === 401) {
        return res.status(500).json({ 
          error: 'Daily.co authentication failed. Please contact the administrator.' 
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to create video call room. Please try again later.' 
      });
    }

    const roomData = await response.json() as { url: string; name: string };
    const dailyRoomUrl = roomData.url;
    // Use room name from response (more accurate than the one we sent)
    const actualRoomName = roomData.name;

    // Generate a token for the user to join the room
    const tokenResponse = await fetch(`${DAILY_API_BASE_URL}/meeting-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DAILY_API_KEY}`
      },
      body: JSON.stringify({
        properties: {
          room_name: actualRoomName,
          is_owner: true, // Host is owner
          exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) // Token expires in 24 hours
        }
      })
    });

    let token: string | undefined;
    if (tokenResponse.ok) {
      const tokenData = await tokenResponse.json() as { token: string };
      token = tokenData.token;
      console.log('✅ Generated Daily.co token for session room');
    } else {
      console.warn('⚠️ Could not generate token, room may still work without it');
    }

    // Save the room URL to the session document
    await db.collection('sessions').doc(sessionId).update({
      dailyRoomUrl: dailyRoomUrl
    });

    console.log(`✅ Created and saved Daily room for session: ${dailyRoomUrl}`);

    return res.status(200).json({ 
      roomUrl: dailyRoomUrl,
      token: token, // Include token in response
      isNewRoom: true
    });

  } catch (error) {
    console.error('❌ Error in createOrGetSessionDailyRoom:', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred while setting up the call.' 
    });
  }
};

/**
 * End/deactivate Daily room for a group call
 * DELETE /api/groups/:groupId/daily-room
 * 
 * Note: This is optional - Daily rooms become inactive when all participants leave.
 * This endpoint allows explicit room deletion if needed.
 */
export const endGroupDailyRoom = async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).send({ error: 'Database not initialized.' });
    }

    const { groupId } = req.params;
    const userId = req.user!.uid;

    // Verify DAILY_API_KEY is configured
    const DAILY_API_KEY = getDailyApiKey();
    if (!DAILY_API_KEY) {
      return res.status(500).json({ 
        error: 'Daily.co API is not configured.' 
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
        error: 'You must be a member of this group to manage calls.' 
      });
    }

    const memberData = memberDoc.data();
    const userRole = memberData?.role || 'member';

    // Only admins/moderators can end calls
    if (userRole !== 'admin' && userRole !== 'moderator') {
      return res.status(403).json({ 
        error: 'Only admins and moderators can end calls.' 
      });
    }

    // Get the group document
    const groupDoc = await db.collection('groups').doc(groupId).get();
    
    if (!groupDoc.exists) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const groupData = groupDoc.data();
    const dailyRoomUrl = groupData?.dailyRoomUrl;

    if (!dailyRoomUrl) {
      return res.status(404).json({ 
        error: 'No active call room found for this group.' 
      });
    }

    // Extract room name from URL
    const roomName = dailyRoomUrl.split('/').pop() || `studyhive-${groupId}`;

    // Delete the Daily room
    try {
      const deleteResponse = await fetch(`${DAILY_API_BASE_URL}/rooms/${roomName}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${DAILY_API_KEY}`
        }
      });

      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        // 404 is okay - room might already be deleted
        const errorData = await deleteResponse.text();
        console.error('⚠️ Error deleting Daily room:', deleteResponse.status, errorData);
      }
    } catch (error) {
      console.error('⚠️ Error deleting Daily room:', error);
      // Continue to remove from database even if API call fails
    }

    // Remove room URL from Firestore
    await db.collection('groups').doc(groupId).update({
      dailyRoomUrl: null
    });

    console.log(`✅ Ended Daily room for group ${groupId}`);

    return res.status(200).json({ 
      message: 'Call room ended successfully. All participants will be disconnected.',
      roomUrl: null
    });

  } catch (error) {
    console.error('❌ Error in endGroupDailyRoom:', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred while ending the call.' 
    });
  }
};

/**
 * End/deactivate Daily room for a session call
 * DELETE /api/sessions/:sessionId/daily-room
 */
export const endSessionDailyRoom = async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).send({ error: 'Database not initialized.' });
    }

    const { sessionId } = req.params;
    const userId = req.user!.uid;

    // Verify DAILY_API_KEY is configured
    const DAILY_API_KEY = getDailyApiKey();
    if (!DAILY_API_KEY) {
      return res.status(500).json({ 
        error: 'Daily.co API is not configured.' 
      });
    }

    // Get the session document
    const sessionDoc = await db.collection('sessions').doc(sessionId).get();
    
    if (!sessionDoc.exists) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const sessionData = sessionDoc.data();
    const groupId = sessionData?.groupId;
    const creatorId = sessionData?.creatorId;

    if (!groupId) {
      return res.status(400).json({ error: 'Session is missing groupId.' });
    }

    // Verify user is the host (creator) or an admin/moderator
    const memberDoc = await db
      .collection('groups')
      .doc(groupId)
      .collection('members')
      .doc(userId)
      .get();

    if (!memberDoc.exists) {
      return res.status(403).json({ 
        error: 'You must be a member of this group to manage calls.' 
      });
    }

    const memberData = memberDoc.data();
    const userRole = memberData?.role || 'member';
    const isHost = creatorId === userId;

    // Only host, admins, or moderators can end calls
    if (!isHost && userRole !== 'admin' && userRole !== 'moderator') {
      return res.status(403).json({ 
        error: 'Only the host, admins, or moderators can end calls.' 
      });
    }

    const dailyRoomUrl = sessionData?.dailyRoomUrl;

    if (!dailyRoomUrl) {
      return res.status(404).json({ 
        error: 'No active call room found for this session.' 
      });
    }

    // Extract room name from URL
    const roomName = dailyRoomUrl.split('/').pop() || `studyhive-session-${sessionId}`;

    // Delete the Daily room
    try {
      const deleteResponse = await fetch(`${DAILY_API_BASE_URL}/rooms/${roomName}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${DAILY_API_KEY}`
        }
      });

      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        // 404 is okay - room might already be deleted
        const errorData = await deleteResponse.text();
        console.error('⚠️ Error deleting Daily room:', deleteResponse.status, errorData);
      }
    } catch (error) {
      console.error('⚠️ Error deleting Daily room:', error);
      // Continue to remove from database even if API call fails
    }

    // Remove room URL from Firestore
    await db.collection('sessions').doc(sessionId).update({
      dailyRoomUrl: null
    });

    console.log(`✅ Ended Daily room for session ${sessionId}`);

    return res.status(200).json({ 
      message: 'Call room ended successfully. All participants will be disconnected.',
      roomUrl: null
    });

  } catch (error) {
    console.error('❌ Error in endSessionDailyRoom:', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred while ending the call.' 
    });
  }
};

