// server/src/controllers/daily.controller.ts

import { Request, Response } from 'express';
import { db } from '../config/firebase.js';
import fetch from 'node-fetch';

const DAILY_API_BASE_URL = 'https://api.daily.co/v1';

// Helper function to get DAILY_API_KEY (reads at runtime, not module load)
const getDailyApiKey = (): string | undefined => {
  const key = process.env.DAILY_API_KEY;
  if (!key) {
    console.error('❌ DAILY_API_KEY is not configured in environment variables');
    console.error('   Make sure DAILY_API_KEY is set in your .env file in the root directory');
    console.error('   Format: DAILY_API_KEY=your_api_key_here');
    console.error('   Then restart the server for changes to take effect.');
  }
  return key;
};

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
    const { forceRecreate } = req.body; // Allow forcing room recreation

    // Verify DAILY_API_KEY is configured (read at runtime)
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
        error: 'You must be a member of this group to join calls.' 
      });
    }

    // Get the group document
    const groupDoc = await db.collection('groups').doc(groupId).get();
    
    if (!groupDoc.exists) {
      return res.status(404).json({ error: 'Group not found.' });
    }

    const groupData = groupDoc.data();

    // If forceRecreate is true, delete existing room and create new one
    if (forceRecreate && groupData?.dailyRoomUrl) {
      const existingRoomUrl = groupData.dailyRoomUrl;
      const roomName = existingRoomUrl.split('/').pop() || `studyhive-${groupId}`;
      
      console.log(`🔄 Force recreating room for group ${groupId}`);
      
      // Delete existing room
      try {
        const deleteResponse = await fetch(`${DAILY_API_BASE_URL}/rooms/${roomName}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${DAILY_API_KEY}`
          }
        });
        
        if (deleteResponse.ok) {
          console.log(`✅ Deleted existing room for force recreate`);
        }
      } catch (deleteError) {
        console.error('Error deleting room for force recreate:', deleteError);
      }
      
      // Remove room URL from Firestore
      await db.collection('groups').doc(groupId).update({
        dailyRoomUrl: null
      });
      
      // Clear the room URL in memory so we skip the existing room check
      groupData.dailyRoomUrl = null;
      
      // Continue to create new room below
    }

    // Check if a Daily room URL already exists (skip if forceRecreate was used)
    if (groupData?.dailyRoomUrl && !forceRecreate) {
      const existingRoomUrl = groupData.dailyRoomUrl;
      
      // Verify the room still exists and is accessible
      try {
        const roomName = existingRoomUrl.split('/').pop() || `studyhive-${groupId}`;
        // Create timeout controller for production environments
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), 10000); // 10 second timeout
        
        const checkResponse = await fetch(`${DAILY_API_BASE_URL}/rooms/${roomName}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${DAILY_API_KEY}`
          },
          signal: timeoutController.signal
        });
        
        clearTimeout(timeoutId);

        if (checkResponse.ok) {
          const roomInfo = await checkResponse.json() as { config?: { privacy?: string } };
          // If room is private, delete it and recreate as public
          if (roomInfo.config?.privacy === 'private') {
            console.log(`⚠️ Existing room is private, deleting and recreating as public for group ${groupId}`);
            
            // Delete the private room
            try {
              // Create timeout controller for delete
              const deleteTimeoutController = new AbortController();
              const deleteTimeoutId = setTimeout(() => deleteTimeoutController.abort(), 10000);
              
              const deleteResponse = await fetch(`${DAILY_API_BASE_URL}/rooms/${roomName}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${DAILY_API_KEY}`
                },
                signal: deleteTimeoutController.signal
              });
              
              clearTimeout(deleteTimeoutId);
              
              if (deleteResponse.ok) {
                console.log(`✅ Deleted private room for group ${groupId}`);
              } else {
                const deleteError = await deleteResponse.text();
                console.log(`⚠️ Could not delete room (${deleteResponse.status}): ${deleteError}`);
              }
            } catch (deleteError: any) {
              if (deleteError.name === 'TimeoutError') {
                console.error('Timeout deleting private room - will create new one anyway');
              } else {
                console.error('Error deleting private room:', deleteError);
              }
            }
            
            // Remove the room URL from Firestore so we create a new one
            await db.collection('groups').doc(groupId).update({
              dailyRoomUrl: null
            });
            
            // Continue to create a new public room below
            console.log(`🔨 Creating new public room to replace private one for group ${groupId}`);
          } else {
            // Room is public, return it
            console.log(`✅ Returning existing public Daily room for group ${groupId}`);
            return res.status(200).json({ 
              roomUrl: existingRoomUrl,
              isNewRoom: false
            });
          }
        } else if (checkResponse.status === 404) {
          // Room doesn't exist, we'll create a new one
          console.log(`⚠️ Existing room URL is invalid (404), creating new room for group ${groupId}`);
          // Remove invalid room URL from Firestore
          await db.collection('groups').doc(groupId).update({
            dailyRoomUrl: null
          });
        } else {
          // Other error (401, 403, 500, etc.) - log and continue to create new room
          const errorText = await checkResponse.text().catch(() => 'Unknown error');
          console.error(`⚠️ Error checking room (${checkResponse.status}): ${errorText}`);
          // Remove potentially invalid room URL from Firestore
          await db.collection('groups').doc(groupId).update({
            dailyRoomUrl: null
          });
        }
      } catch (error: any) {
        // Handle timeout and other network errors
        if (error.name === 'TimeoutError') {
          console.error('Timeout checking existing room - will create new one');
        } else {
          console.error('Error checking existing room:', error);
        }
        // Continue to create a new room
        // Remove potentially invalid room URL from Firestore
        try {
          await db.collection('groups').doc(groupId).update({
            dailyRoomUrl: null
          });
        } catch (updateError) {
          console.error('Error clearing room URL from Firestore:', updateError);
        }
      }
    }

    // Create a new Daily.co room
    console.log(`🔨 Creating new Daily room for group ${groupId}`);
    
    const roomName = `studyhive-${groupId}`;
    
    // Create timeout controller for room creation (30 seconds for production)
    const createTimeoutController = new AbortController();
    const createTimeoutId = setTimeout(() => createTimeoutController.abort(), 30000);
    
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
          max_participants: 5 // Free plan limit (can be upgraded for more)
        }
      }),
      signal: createTimeoutController.signal
    });
    
    clearTimeout(createTimeoutId);

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

/**
 * Get or create a Daily.co room for a study session
 * POST /api/sessions/:sessionId/call
 */
export const getOrCreateSessionDailyRoom = async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).send({ error: 'Database not initialized.' });
    }

    const { sessionId } = req.params;
    const userId = req.user!.uid;

    // Verify DAILY_API_KEY is configured (read at runtime)
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
          const roomInfo = await checkResponse.json() as { config?: { privacy?: string } };
          // If room is private, delete it and recreate as public
          if (roomInfo.config?.privacy === 'private') {
            console.log(`⚠️ Existing session room is private, deleting and recreating as public for session ${sessionId}`);
            
            // Delete the private room
            try {
              const deleteResponse = await fetch(`${DAILY_API_BASE_URL}/rooms/${roomName}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${DAILY_API_KEY}`
                }
              });
              
              if (deleteResponse.ok) {
                console.log(`✅ Deleted private session room for session ${sessionId}`);
              } else {
                console.log(`⚠️ Could not delete session room, will create new one anyway`);
              }
            } catch (deleteError) {
              console.error('Error deleting private session room:', deleteError);
            }
            
            // Remove the room URL from Firestore so we create a new one
            await db.collection('sessions').doc(sessionId).update({
              dailyRoomUrl: null
            });
            
            // Continue to create a new public room below
            console.log(`🔨 Creating new public session room to replace private one for session ${sessionId}`);
          } else {
            // Room is public, return it
            console.log(`✅ Returning existing public Daily room for session ${sessionId}`);
            return res.status(200).json({ 
              roomUrl: existingRoomUrl,
              isNewRoom: false
            });
          }
        } else {
          // Room doesn't exist, we'll create a new one
          console.log(`⚠️ Existing session room URL is invalid, creating new room for session ${sessionId}`);
          // Remove invalid room URL from Firestore
          await db.collection('sessions').doc(sessionId).update({
            dailyRoomUrl: null
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
          max_participants: 5 // Free plan limit (can be upgraded for more)
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

    // Save the room URL to the session document
    await db.collection('sessions').doc(sessionId).update({
      dailyRoomUrl: dailyRoomUrl
    });

    console.log(`✅ Created and saved Daily room for session: ${dailyRoomUrl}`);

    return res.status(200).json({ 
      roomUrl: dailyRoomUrl,
      isNewRoom: true
    });

  } catch (error) {
    console.error('❌ Error in getOrCreateSessionDailyRoom:', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred while setting up the call.' 
    });
  }
};

