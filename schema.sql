--
-- PostgreSQL database dump
--

\restrict eKS7VXAaFxHQNoA6ASoqeZDQNz65zgyffaROrBwoW7iHtb7WFUdJ3IYMDW9aTBL

-- Dumped from database version 16.15 (Homebrew)
-- Dumped by pg_dump version 16.15 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: daily_summaries; Type: TABLE; Schema: public; Owner: bigboss
--

CREATE TABLE public.daily_summaries (
    summary_id bigint NOT NULL,
    user_id bigint NOT NULL,
    date date NOT NULL,
    is_smoke_free boolean DEFAULT true NOT NULL,
    saved_money integer DEFAULT 0 NOT NULL,
    exercise_minutes_total integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.daily_summaries OWNER TO bigboss;

--
-- Name: daily_summaries_summary_id_seq; Type: SEQUENCE; Schema: public; Owner: bigboss
--

ALTER TABLE public.daily_summaries ALTER COLUMN summary_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.daily_summaries_summary_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: exercise_logs; Type: TABLE; Schema: public; Owner: bigboss
--

CREATE TABLE public.exercise_logs (
    exercise_log_id bigint NOT NULL,
    user_id bigint NOT NULL,
    exercise_id bigint NOT NULL,
    symptom_log_id bigint,
    duration_completed integer NOT NULL,
    intensity_after integer,
    completed_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT exercise_logs_duration_completed_check CHECK ((duration_completed >= 0)),
    CONSTRAINT exercise_logs_intensity_after_check CHECK (((intensity_after >= 0) AND (intensity_after <= 10)))
);


ALTER TABLE public.exercise_logs OWNER TO bigboss;

--
-- Name: exercise_logs_exercise_log_id_seq; Type: SEQUENCE; Schema: public; Owner: bigboss
--

ALTER TABLE public.exercise_logs ALTER COLUMN exercise_log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.exercise_logs_exercise_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: exercises; Type: TABLE; Schema: public; Owner: bigboss
--

CREATE TABLE public.exercises (
    exercise_id bigint NOT NULL,
    title character varying(200) NOT NULL,
    category character varying(50) NOT NULL,
    duration_minutes integer NOT NULL,
    intensity character varying(20) NOT NULL,
    target_symptom character varying(50),
    video_url text,
    CONSTRAINT exercises_duration_minutes_check CHECK ((duration_minutes > 0)),
    CONSTRAINT exercises_intensity_check CHECK (((intensity)::text = ANY ((ARRAY['LOW'::character varying, 'MEDIUM'::character varying, 'HIGH'::character varying])::text[])))
);


ALTER TABLE public.exercises OWNER TO bigboss;

--
-- Name: exercises_exercise_id_seq; Type: SEQUENCE; Schema: public; Owner: bigboss
--

ALTER TABLE public.exercises ALTER COLUMN exercise_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.exercises_exercise_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: point_logs; Type: TABLE; Schema: public; Owner: bigboss
--

CREATE TABLE public.point_logs (
    point_log_id bigint NOT NULL,
    user_id bigint NOT NULL,
    point_type character varying(50) NOT NULL,
    points integer NOT NULL,
    reference_id bigint,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.point_logs OWNER TO bigboss;

--
-- Name: point_logs_point_log_id_seq; Type: SEQUENCE; Schema: public; Owner: bigboss
--

ALTER TABLE public.point_logs ALTER COLUMN point_log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.point_logs_point_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: smoke_logs; Type: TABLE; Schema: public; Owner: bigboss
--

CREATE TABLE public.smoke_logs (
    smoke_log_id bigint NOT NULL,
    user_id bigint NOT NULL,
    cigarettes_smoked integer NOT NULL,
    trigger_cause character varying(100),
    logged_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT smoke_logs_cigarettes_smoked_check CHECK ((cigarettes_smoked > 0))
);


ALTER TABLE public.smoke_logs OWNER TO bigboss;

--
-- Name: smoke_logs_smoke_log_id_seq; Type: SEQUENCE; Schema: public; Owner: bigboss
--

ALTER TABLE public.smoke_logs ALTER COLUMN smoke_log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.smoke_logs_smoke_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: symptom_logs; Type: TABLE; Schema: public; Owner: bigboss
--

CREATE TABLE public.symptom_logs (
    symptom_log_id bigint NOT NULL,
    user_id bigint NOT NULL,
    symptom_type character varying(50) NOT NULL,
    intensity_before integer NOT NULL,
    logged_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT symptom_logs_intensity_before_check CHECK (((intensity_before >= 0) AND (intensity_before <= 10)))
);


ALTER TABLE public.symptom_logs OWNER TO bigboss;

--
-- Name: symptom_logs_symptom_log_id_seq; Type: SEQUENCE; Schema: public; Owner: bigboss
--

ALTER TABLE public.symptom_logs ALTER COLUMN symptom_log_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.symptom_logs_symptom_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: bigboss
--

CREATE TABLE public.user_profiles (
    profile_id bigint NOT NULL,
    user_id bigint NOT NULL,
    quit_start_date timestamp without time zone NOT NULL,
    daily_cigarette_count integer NOT NULL,
    pack_price integer NOT NULL,
    fitness_level character varying(20) DEFAULT 'BEGINNER'::character varying NOT NULL,
    CONSTRAINT user_profiles_daily_cigarette_count_check CHECK ((daily_cigarette_count >= 0)),
    CONSTRAINT user_profiles_fitness_level_check CHECK (((fitness_level)::text = ANY ((ARRAY['BEGINNER'::character varying, 'INTERMEDIATE'::character varying, 'ADVANCED'::character varying])::text[]))),
    CONSTRAINT user_profiles_pack_price_check CHECK ((pack_price >= 0))
);


ALTER TABLE public.user_profiles OWNER TO bigboss;

--
-- Name: user_profiles_profile_id_seq; Type: SEQUENCE; Schema: public; Owner: bigboss
--

ALTER TABLE public.user_profiles ALTER COLUMN profile_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_profiles_profile_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_ranks; Type: TABLE; Schema: public; Owner: bigboss
--

CREATE TABLE public.user_ranks (
    user_id bigint NOT NULL,
    total_points integer DEFAULT 0 NOT NULL,
    weekly_points integer DEFAULT 0 NOT NULL,
    monthly_points integer DEFAULT 0 NOT NULL,
    current_rank integer,
    weekly_rank integer,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_ranks OWNER TO bigboss;

--
-- Name: users; Type: TABLE; Schema: public; Owner: bigboss
--

CREATE TABLE public.users (
    user_id bigint NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    nickname character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.users OWNER TO bigboss;

--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: bigboss
--

ALTER TABLE public.users ALTER COLUMN user_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: daily_summaries daily_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.daily_summaries
    ADD CONSTRAINT daily_summaries_pkey PRIMARY KEY (summary_id);


--
-- Name: daily_summaries daily_summaries_user_id_date_key; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.daily_summaries
    ADD CONSTRAINT daily_summaries_user_id_date_key UNIQUE (user_id, date);


--
-- Name: exercise_logs exercise_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.exercise_logs
    ADD CONSTRAINT exercise_logs_pkey PRIMARY KEY (exercise_log_id);


--
-- Name: exercises exercises_pkey; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.exercises
    ADD CONSTRAINT exercises_pkey PRIMARY KEY (exercise_id);


--
-- Name: point_logs point_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.point_logs
    ADD CONSTRAINT point_logs_pkey PRIMARY KEY (point_log_id);


--
-- Name: smoke_logs smoke_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.smoke_logs
    ADD CONSTRAINT smoke_logs_pkey PRIMARY KEY (smoke_log_id);


--
-- Name: symptom_logs symptom_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.symptom_logs
    ADD CONSTRAINT symptom_logs_pkey PRIMARY KEY (symptom_log_id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (profile_id);


--
-- Name: user_profiles user_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_key UNIQUE (user_id);


--
-- Name: user_ranks user_ranks_pkey; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.user_ranks
    ADD CONSTRAINT user_ranks_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_nickname_key; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_nickname_key UNIQUE (nickname);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: idx_exercise_logs_exercise; Type: INDEX; Schema: public; Owner: bigboss
--

CREATE INDEX idx_exercise_logs_exercise ON public.exercise_logs USING btree (exercise_id);


--
-- Name: idx_exercise_logs_user_time; Type: INDEX; Schema: public; Owner: bigboss
--

CREATE INDEX idx_exercise_logs_user_time ON public.exercise_logs USING btree (user_id, completed_at DESC);


--
-- Name: idx_exercises_target_symptom; Type: INDEX; Schema: public; Owner: bigboss
--

CREATE INDEX idx_exercises_target_symptom ON public.exercises USING btree (target_symptom);


--
-- Name: idx_point_logs_user_time; Type: INDEX; Schema: public; Owner: bigboss
--

CREATE INDEX idx_point_logs_user_time ON public.point_logs USING btree (user_id, created_at DESC);


--
-- Name: idx_smoke_logs_user_time; Type: INDEX; Schema: public; Owner: bigboss
--

CREATE INDEX idx_smoke_logs_user_time ON public.smoke_logs USING btree (user_id, logged_at DESC);


--
-- Name: idx_symptom_logs_user_time; Type: INDEX; Schema: public; Owner: bigboss
--

CREATE INDEX idx_symptom_logs_user_time ON public.symptom_logs USING btree (user_id, logged_at DESC);


--
-- Name: idx_user_ranks_total; Type: INDEX; Schema: public; Owner: bigboss
--

CREATE INDEX idx_user_ranks_total ON public.user_ranks USING btree (total_points DESC);


--
-- Name: idx_user_ranks_weekly; Type: INDEX; Schema: public; Owner: bigboss
--

CREATE INDEX idx_user_ranks_weekly ON public.user_ranks USING btree (weekly_points DESC);


--
-- Name: uq_exercise_logs_symptom; Type: INDEX; Schema: public; Owner: bigboss
--

CREATE UNIQUE INDEX uq_exercise_logs_symptom ON public.exercise_logs USING btree (symptom_log_id) WHERE (symptom_log_id IS NOT NULL);


--
-- Name: daily_summaries daily_summaries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.daily_summaries
    ADD CONSTRAINT daily_summaries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: exercise_logs exercise_logs_exercise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.exercise_logs
    ADD CONSTRAINT exercise_logs_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES public.exercises(exercise_id);


--
-- Name: exercise_logs exercise_logs_symptom_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.exercise_logs
    ADD CONSTRAINT exercise_logs_symptom_log_id_fkey FOREIGN KEY (symptom_log_id) REFERENCES public.symptom_logs(symptom_log_id) ON DELETE SET NULL;


--
-- Name: exercise_logs exercise_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.exercise_logs
    ADD CONSTRAINT exercise_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: point_logs point_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.point_logs
    ADD CONSTRAINT point_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: smoke_logs smoke_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.smoke_logs
    ADD CONSTRAINT smoke_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: symptom_logs symptom_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.symptom_logs
    ADD CONSTRAINT symptom_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: user_ranks user_ranks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: bigboss
--

ALTER TABLE ONLY public.user_ranks
    ADD CONSTRAINT user_ranks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict eKS7VXAaFxHQNoA6ASoqeZDQNz65zgyffaROrBwoW7iHtb7WFUdJ3IYMDW9aTBL

