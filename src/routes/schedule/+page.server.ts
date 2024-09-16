import {
	DateFormatter,
	getLocalTimeZone,
	isSameDay,
	parseAbsoluteToLocal,
	parseZonedDateTime,
	today
} from '@internationalized/date';
import nodemailer from 'nodemailer';
import mg from 'nodemailer-mailgun-transport';

import {
	CALENDAR_CLIENT_EMAIL,
	CALENDAR_PRIVATE_KEY,
	EMAIL_API_KEY,
	EMAIL_DOMAIN
} from '$env/static/private';
import { redirect } from '@sveltejs/kit';
import { JWT } from 'google-auth-library';
import { google } from 'googleapis';
import type { PageServerLoad } from './$types.js';

const SCOPES = [
	'https://www.googleapis.com/auth/calendar',
	'https://www.googleapis.com/auth/calendar.events'
];
const CALENDAR_ID =
	'840dfa8a8e3b6e75c172d138cfb3a745ed64ce752bafe00e48a1bcd1865f9dc1@group.calendar.google.com';

type CalendarEvent = {
	summary: string;
	start: { dateTime: string; timeZone: string };
	end: { dateTime: string; timeZone: string };
	status: string;
};

const mailgunAuth = {
	auth: {
		api_key: EMAIL_API_KEY,
		domain: EMAIL_DOMAIN
	}
};

const calendarAuth = new JWT({
	email: CALENDAR_CLIENT_EMAIL,
	key: CALENDAR_PRIVATE_KEY,
	scopes: SCOPES
});

const nodemailerMailgun = nodemailer.createTransport(mg(mailgunAuth));

export const load: PageServerLoad = async () => {
	const items = google
		.calendar({ version: 'v3' })
		.events.list({
			auth: calendarAuth,
			calendarId: CALENDAR_ID,
			showDeleted: false,
			singleEvents: true,
			maxResults: 10,
			timeMin: today(getLocalTimeZone()).toDate('America/Denver').toISOString(),
			orderBy: 'startTime'
		})
		.then((res) => res.data)
		.then((data) => {
			const events = data.items as CalendarEvent[];

			return events
				.filter((i) => i.summary === 'Free')
				.map((i) => {
					const startDate = parseAbsoluteToLocal(i.start.dateTime);
					const endDate = parseAbsoluteToLocal(i.end.dateTime);
					const hours = endDate.toDate().getHours() - startDate.toDate().getHours();
					const otherEventsOnDay = events.filter(
						(se) =>
							isSameDay(startDate, parseAbsoluteToLocal(se.start.dateTime)) && se.summary !== 'Free'
					);

					const times = [...Array(hours).keys()].map((t) => {
						const hour = parseAbsoluteToLocal(i.start.dateTime).add({ hours: t });
						const reserved = otherEventsOnDay.find(
							(se) => parseAbsoluteToLocal(se.start.dateTime).toString() === hour.toString()
						);

						return {
							time: hour.toString(),
							reserved: reserved !== undefined
						};
					});
					return {
						summary: i.summary,
						start: i.start.dateTime,
						end: i.end.dateTime,
						times: times.filter((t) => !t.reserved)
					};
				});
		});

	return { events: items };
};

export const actions = {
	default: async ({ request }) => {
		let error;

		const data = await request.formData();

		nodemailerMailgun.sendMail(
			{
				from: 'mailgun@sandboxb377c6e2383f42359367d636f993f6f8.mailgun.org',
				to: 'daniel.herrera33@proton.me',
				subject: 'New Meeting Request',
				text: `Date: ${data.get('date')}\nTime: ${formatTimeFromString(
					data.get('startTime') as string
				)}\nName: ${data.get('name')}\nEmail: ${data.get('email')}\nService: ${data.get('service')}`
			},
			(err) => {
				if (err) {
					error = err;
				}
			}
		);

		const timeZone = data.get('startTime')!.toString().slice(26, -1);
		const startTime = data.get('startTime')!.toString().slice(0, 25);
		const endTime = parseZonedDateTime(data.get('startTime') as string)
			.add({ hours: 1 })
			.toString()
			.slice(0, 25);

		google.calendar({ version: 'v3' }).events.insert(
			{
				auth: calendarAuth,
				calendarId: CALENDAR_ID,
				sendUpdates: 'all',
				requestBody: {
					summary: `${data.get('name')} - ${data.get('service')}`,
					start: { dateTime: startTime, timeZone },
					end: { dateTime: endTime, timeZone },
					status: 'tentative'
				}
			},
			(err: Error) => {
				if (err) {
					error = err;
				}
			}
		);
		if (error) {
			alert('Something went wrong, please try again.');
		} else {
			redirect(303, '/schedule/reserved');
		}
	}
};

const formatTimeFromString = (time: string) => {
	return new DateFormatter('en-US', { hour: 'numeric', hour12: true }).format(
		parseZonedDateTime(time).toDate()
	);
};
