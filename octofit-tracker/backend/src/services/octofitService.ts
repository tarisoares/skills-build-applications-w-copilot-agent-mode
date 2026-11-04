import { Types } from 'mongoose';
import { Activity, Team, User, Workout } from '../models/index.js';

type ServiceError = Error & { status: number };

function serviceError(status: number, message: string): ServiceError {
  return Object.assign(new Error(message), { status });
}

function recordInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw serviceError(400, 'Request body must be an object');
  }
  return input as Record<string, unknown>;
}

export async function listActivities() {
  return Activity.find().lean();
}

export async function createActivity(input: unknown) {
  const body = recordInput(input);
  const { userId, teamId, type, minutes } = body;
  if (
    typeof userId !== 'string' ||
    typeof teamId !== 'string' ||
    !Types.ObjectId.isValid(userId) ||
    !Types.ObjectId.isValid(teamId) ||
    typeof type !== 'string' ||
    type.trim().length === 0 ||
    typeof minutes !== 'number' ||
    !Number.isFinite(minutes) ||
    minutes <= 0
  ) {
    throw serviceError(400, 'Activity requires valid userId, teamId, type, and minutes');
  }

  const [user, team] = await Promise.all([
    User.findById(userId).select('_id').lean(),
    Team.findById(teamId).select('_id').lean(),
  ]);
  if (!user || !team) throw serviceError(400, 'Activity user and team must exist');

  return Activity.create({
    user: user._id,
    team: team._id,
    type: type.trim(),
    minutes,
    points: minutes,
    occurredAt: new Date(),
  });
}

export async function listTeams() {
  return Team.find().lean();
}

export async function createTeam(input: unknown) {
  const body = recordInput(input);
  const { name, mascot, members = [] } = body;
  if (typeof name !== 'string' || name.trim().length === 0 || typeof mascot !== 'string' || mascot.trim().length === 0) {
    throw serviceError(400, 'Team requires a name and mascot');
  }
  if (!Array.isArray(members) || members.some((member) => typeof member !== 'string' || !Types.ObjectId.isValid(member))) {
    throw serviceError(400, 'Team members must be valid user IDs');
  }

  const memberIds = members.map((member) => new Types.ObjectId(member));
  if (memberIds.length > 0) {
    const existingMembers = await User.countDocuments({ _id: { $in: memberIds } });
    if (existingMembers !== memberIds.length) throw serviceError(400, 'Team members must exist');
  }

  return Team.create({ name: name.trim(), mascot: mascot.trim(), members: memberIds });
}

export async function getLeaderboard() {
  const totals = await Activity.aggregate([
    { $group: { _id: '$team', totalPoints: { $sum: '$points' } } },
    { $lookup: { from: 'teams', localField: '_id', foreignField: '_id', as: 'team' } },
    { $unwind: '$team' },
    { $project: { _id: 0, teamName: '$team.name', totalPoints: 1 } },
    { $sort: { totalPoints: -1, teamName: 1 } },
  ]);

  return totals.map((entry, index) => ({
    teamName: entry.teamName,
    totalPoints: entry.totalPoints,
    rank: index + 1,
  }));
}

export async function suggestWorkouts(userEmail: string) {
  const user = await User.findOne({ email: userEmail }).lean();
  if (!user) throw serviceError(404, 'User not found');

  const recentActivity = await Activity.findOne({ user: user._id }).sort({ occurredAt: -1 }).lean();
  const focus = user.fitnessGoal || recentActivity?.type;
  const workouts = focus
    ? await Workout.find({ focus }).lean()
    : await Workout.find().lean();
  const fallback = workouts.length > 0 ? workouts : await Workout.find().lean();
  const reason = focus
    ? `Recommended for your ${focus} goal and recent activity.`
    : 'Recommended from the available workout catalog.';

  return fallback.map((workout) => ({ ...workout, reason }));
}

export { User };
