/**
 * Call State Service
 * 
 * HYBRID ARCHITECTURE:
 * - Jitsi Meet API handles ALL audio/video communication
 * - Firebase is used ONLY for lightweight UI call state (started/ended)
 * 
 * IMPORTANT RULES:
 * - Firebase must NOT be used for: signaling, media, ICE/SDP, participant metadata
 * - Firebase may ONLY store: call started, call ended
 * - Firestore MUST NEVER receive undefined values
 * - Jitsi remains the single source of truth for actual calls
 */

import { db } from '../config/firebase';

export type CallType = 'group' | 'direct';
export type CallStatus = 'started' | 'ended';

/**
 * Minimal call state schema for Firebase
 * 
 * DO NOT include:
 * - participants object
 * - profileImageUrl
 * - user metadata
 * - media-related information
 * - optional user data
 */
export interface MinimalCallState {
  type: CallType;
  roomName: string;
  status: CallStatus;
  createdBy: string;
  createdAt: FirebaseFirestore.FieldValue;
  endedAt?: FirebaseFirestore.FieldValue;
}

/**
 * Start a call - write minimal state to Firebase
 * 
 * This is UI-only state. Jitsi handles all actual media.
 */
export async function startCallState(
  roomName: string,
  callType: CallType,
  createdBy: string
): Promise<void> {
  if (!db) {
    console.warn('⚠️  Firebase not initialized, skipping call state write');
    return;
  }

  try {
    // Defensive check: ensure no undefined values
    if (!roomName || !callType || !createdBy) {
      console.error('❌ startCallState: Missing required fields', {
        roomName: !!roomName,
        callType: !!callType,
        createdBy: !!createdBy,
      });
      return;
    }

    // Use roomName as document ID for easy lookup
    const callRef = db.collection('callStates').doc(roomName);

    const callState: MinimalCallState = {
      type: callType,
      roomName: roomName,
      status: 'started',
      createdBy: createdBy,
      createdAt: db.FieldValue.serverTimestamp(),
      // endedAt is not set when starting
    };

    // Write to Firestore
    await callRef.set(callState);
    console.log(`✅ Call state started: ${roomName} (${callType})`);
  } catch (error: any) {
    console.error('❌ Error starting call state:', error.message);
    // Don't throw - call state is UI-only, Jitsi call can still work
  }
}

/**
 * End a call - update status in Firebase
 * 
 * This is UI-only state. Jitsi handles actual call termination.
 */
export async function endCallState(
  roomName: string,
  endedBy: string
): Promise<void> {
  if (!db) {
    console.warn('⚠️  Firebase not initialized, skipping call state write');
    return;
  }

  try {
    // Defensive check: ensure no undefined values
    if (!roomName || !endedBy) {
      console.error('❌ endCallState: Missing required fields', {
        roomName: !!roomName,
        endedBy: !!endedBy,
      });
      return;
    }

    const callRef = db.collection('callStates').doc(roomName);

    // Update only status and endedAt - no other fields
    await callRef.update({
      status: 'ended',
      endedAt: db.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Call state ended: ${roomName}`);
  } catch (error: any) {
    // If document doesn't exist, that's okay - call might have been cleaned up
    if (error.code === 5) {
      console.log(`ℹ️  Call state document not found: ${roomName} (already cleaned up)`);
      return;
    }
    console.error('❌ Error ending call state:', error.message);
    // Don't throw - call state is UI-only, Jitsi call can still work
  }
}

/**
 * Get call state from Firebase (for UI purposes only)
 */
export async function getCallState(
  roomName: string
): Promise<MinimalCallState | null> {
  if (!db) {
    return null;
  }

  try {
    const callRef = db.collection('callStates').doc(roomName);
    const doc = await callRef.get();

    if (!doc.exists) {
      return null;
    }

    return doc.data() as MinimalCallState;
  } catch (error: any) {
    console.error('❌ Error getting call state:', error.message);
    return null;
  }
}

