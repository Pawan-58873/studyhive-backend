// server/src/controllers/session.controller.ts

import { Request, Response } from 'express';
import { db } from '../config/firebase';
import { InsertStudySession, insertStudySessionSchema } from '../shared/schema';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * Create a new study session for a group
 */
export const createSession = async (req: Request, res: Response) => {
  try {
    // 1. Validate request body against Zod schema
    // NAYI LINE: Date string ko Date object me convert karna
    if (req.body.startTime) {
        req.body.startTime = new Date(req.body.startTime);
    }
      
    // 1. Validate request body against Zod schema
    const sessionData: InsertStudySession = insertStudySessionSchema.parse(req.body);

    // 2. Prepare the data for Firestore
    const newSessionData = {
      ...sessionData,
      startTime: Timestamp.fromDate(new Date(sessionData.startTime)), // Convert JS Date to Firestore Timestamp
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    // 3. Add the new session to the 'sessions' collection
    const docRef = await db.collection('sessions').add(newSessionData);

    // 4. Send back the newly created session with its ID
    res.status(201).json({ id: docRef.id, ...newSessionData });

  } catch (error) {
    console.error("Error creating session:", error);
    // Handle Zod validation errors specifically
    if (error instanceof Error && error.name === 'ZodError') {
      return res.status(400).json({ message: "Invalid data provided", errors: error });
    }
    res.status(500).json({ message: "Something went wrong on the server." });
  }
};

/**
 * Get all study sessions, with optional filtering by groupId and date range
 */
export const getGroupSessions = async (req: Request, res: Response) => {
  try {
    const { groupId, startDate, endDate } = req.query;

    // Start building the query on the 'sessions' collection
    let query: FirebaseFirestore.Query = db.collection('sessions');

    // 1. Filter by group if groupId is provided
    if (groupId && typeof groupId === 'string') {
      query = query.where('groupId', '==', groupId);
    }

    // 2. Filter by start date if provided
    if (startDate && typeof startDate === 'string') {
      query = query.where('startTime', '>=', Timestamp.fromDate(new Date(startDate)));
    }

    // 3. Filter by end date if provided
    if (endDate && typeof endDate === 'string') {
      // Note: Firestore range queries (<, <=, >, >=) must all be on the same field.
      query = query.where('startTime', '<=', Timestamp.fromDate(new Date(endDate)));
    }

    // Order results by start time to show upcoming sessions first
    query = query.orderBy('startTime', 'asc');

    const snapshot = await query.get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    // Map documents to an array of session objects
    const sessions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(sessions);

  } catch (error: any) {
    console.error("Error fetching sessions:", error);
    
    // Handle Firestore index missing or building error with a helpful message
    if (error.code === 9 || error.message?.includes('requires an index')) {
      // Check if the index is currently building
      const isIndexBuilding = error.details?.includes('currently building') || 
                              error.message?.includes('currently building');
      
      // Extract the index status URL if available
      const indexUrl = error.details?.match(/https:\/\/console\.firebase\.google\.com[^\s]+/)?.[0];
      
      if (isIndexBuilding) {
        console.log("⏳ Firestore index is currently building. Please wait...");
        return res.status(503).json({ 
          message: "Database is being optimized. Please try again in 2-5 minutes.",
          error: "INDEX_BUILDING",
          details: indexUrl 
            ? `Check index status here: ${indexUrl}`
            : "The database index is being created. This typically takes 2-5 minutes."
        });
      }
      
      console.error("⚠️ Firestore composite index required. Please create the index using Firebase Console.");
      return res.status(503).json({ 
        message: "Database index is being created. Please try again in a few minutes.",
        error: "INDEX_REQUIRED",
        details: indexUrl 
          ? `You can create the required index here: ${indexUrl}`
          : "A composite index for sessions (groupId + startTime) is required. Deploy indexes using: firebase deploy --only firestore:indexes"
      });
    }
    
    // Handle other Firestore errors
    if (error.code) {
      return res.status(500).json({ 
        message: "Database error occurred.", 
        error: error.code 
      });
    }
    
    res.status(500).json({ message: "Something went wrong on the server." });
  }
};

/**
 * Update an existing study session.
 * Only the session creator or a group admin can update.
 */
export const updateSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user!.uid;

    const sessionRef = db.collection('sessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return res.status(404).json({ message: 'Session not found.' });
    }

    const sessionData = sessionDoc.data() as any;
    const groupId = sessionData.groupId;

    if (!groupId) {
      return res.status(400).json({ message: 'Session is missing groupId.' });
    }

    // Check if user is creator or group admin
    const isCreator = sessionData.creatorId === userId;
    const memberDoc = await db
      .collection('groups')
      .doc(groupId)
      .collection('members')
      .doc(userId)
      .get();

    const isAdmin = memberDoc.exists && memberDoc.data()?.role === 'admin';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({ message: 'You are not allowed to update this session.' });
    }

    const { title, description, startTime, sessionUrl } = req.body;
    const updates: any = {};

    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (sessionUrl !== undefined) updates.sessionUrl = sessionUrl;
    if (startTime !== undefined) {
      const date = new Date(startTime);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ message: 'Invalid startTime.' });
      }
      updates.startTime = Timestamp.fromDate(date);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update.' });
    }

    updates.updatedAt = Timestamp.now();

    await sessionRef.update(updates);

    const updatedDoc = await sessionRef.get();

    res.status(200).json({ id: updatedDoc.id, ...updatedDoc.data() });
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({ message: 'Failed to update session.' });
  }
};

/**
 * Delete a study session.
 * Only the session creator or a group admin can delete.
 */
export const deleteSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user!.uid;

    const sessionRef = db.collection('sessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return res.status(404).json({ message: 'Session not found.' });
    }

    const sessionData = sessionDoc.data() as any;
    const groupId = sessionData.groupId;

    if (!groupId) {
      return res.status(400).json({ message: 'Session is missing groupId.' });
    }

    const isCreator = sessionData.creatorId === userId;
    const memberDoc = await db
      .collection('groups')
      .doc(groupId)
      .collection('members')
      .doc(userId)
      .get();

    const isAdmin = memberDoc.exists && memberDoc.data()?.role === 'admin';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({ message: 'You are not allowed to delete this session.' });
    }

    await sessionRef.delete();

    res.status(200).json({ message: 'Session deleted successfully.' });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ message: 'Failed to delete session.' });
  }
};